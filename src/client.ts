// Minimal read-only ClassCharts parent client.
// Reference: classchartsapi/classcharts-api-js (ISC) and its unofficial docs.
// Deliberately exposes no write endpoints (no password change, behaviour, ticking).

import { memorySessionStore, type SessionStore } from "./session.ts";
import type {
  ApiResponse,
  AttendanceMeta,
  RawActivityPoint,
  RawAnnouncement,
  RawAttendanceSession,
  RawDetention,
  RawHomework,
  RawLesson,
  RawPupil,
  TimetableMeta,
} from "./types.ts";

const BASE = "https://www.classcharts.com";
const API = `${BASE}/apiv2parent`;
const USER_AGENT = "classcharts-agent (read-only)";
/** ClassCharts rotates session ids; refresh a bit before the ~3 minute mark. */
const REFRESH_AFTER_MS = 150_000;

export class ClassChartsAuthError extends Error {}

export interface ClientOptions {
  email: string;
  password: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Where to keep the session between runs (default: in memory only). */
  session?: SessionStore;
}

export class ClassChartsClient {
  private cookie = "";
  private sessionId = "";
  private refreshedAt = 0;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly opts: ClientOptions;
  private readonly store: SessionStore;
  private auth: Promise<void> | undefined; // shared so parallel requests log in once
  private logins = 0; // lets a rejected request tell whether a fresh login happened

  constructor(opts: ClientOptions) {
    if (!opts.email || !opts.password) {
      throw new ClassChartsAuthError("Missing CLASSCHARTS_EMAIL or CLASSCHARTS_PASSWORD.");
    }
    this.opts = opts;
    this.fetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.store = opts.session ?? memorySessionStore();
    const cached = this.store.load();
    if (cached) Object.assign(this, cached);
  }

  private persist() {
    this.store.save({ cookie: this.cookie, sessionId: this.sessionId, refreshedAt: this.refreshedAt });
  }

  /** Run one auth step at a time; concurrent callers share it. */
  private once(step: () => Promise<void>): Promise<void> {
    this.auth ??= step().finally(() => {
      this.auth = undefined;
    });
    return this.auth;
  }

  async login(): Promise<void> {
    const res = await this.fetch(`${BASE}/parent/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: new URLSearchParams({
        _method: "POST",
        email: this.opts.email,
        logintype: "existing",
        password: this.opts.password,
        "recaptcha-token": "no-token-available",
      }),
    });
    const pairs = res.headers.getSetCookie().map((c) => c.split(";")[0]);
    const creds = pairs.find((c) => c.startsWith("parent_session_credentials="));
    if (res.status !== 302 || !creds) {
      if (res.status === 302 && /\/parent\/login/.test(res.headers.get("location") ?? "")) {
        // Seen for "Too many attempts"; a wrong password may look the same.
        throw new ClassChartsAuthError(
          "ClassCharts sent the login back to its sign-in page. Usually that's too many attempts " +
            "(wait a few minutes, don't retry in a loop); otherwise the email or password is wrong.",
        );
      }
      throw new ClassChartsAuthError(
        `Login failed (HTTP ${res.status}). Check the parent email/password; ` +
          "if they're right, ClassCharts may have changed its login flow.",
      );
    }
    this.cookie = pairs.join("; ");
    try {
      this.sessionId = JSON.parse(decodeURIComponent(creds.slice(creds.indexOf("=") + 1))).session_id;
    } catch {
      this.sessionId = "";
    }
    if (!this.sessionId) {
      throw new ClassChartsAuthError("Login response not understood; ClassCharts may have changed its login flow.");
    }
    this.refreshedAt = this.now();
    this.logins++;
    this.persist();
  }

  private async raw<T, M>(path: string, init: RequestInit = {}): Promise<Reply<T, M>> {
    const res = await this.fetch(`${API}${path}`, {
      ...init,
      headers: {
        Cookie: this.cookie,
        Authorization: `Basic ${this.sessionId}`,
        "User-Agent": USER_AGENT,
      },
    });
    const text = await res.text();
    let body: ApiResponse<T, M> | undefined;
    try {
      body = JSON.parse(text);
    } catch {
      // handled below
    }
    // 401/403 or success: 0 = ClassCharts refused this request (maybe the session, maybe not).
    const refused = res.status === 401 || res.status === 403 || body?.success === 0;
    if (!refused && !res.ok) throw new Error(`ClassCharts returned HTTP ${res.status} for ${path}. Try again later.`);
    if (!refused && (!body || typeof body !== "object")) {
      throw new Error(`ClassCharts returned HTTP ${res.status} without JSON for ${path}.`);
    }
    return { refused, error: body?.error, body: body as ApiResponse<T, M> };
  }

  private async refresh(): Promise<void> {
    const body = new URLSearchParams({ include_data: "true" });
    const ping = await this.raw<unknown, { session_id?: string }>("/ping", { method: "POST", body });
    const id = ping.body?.meta?.session_id;
    if (ping.refused || !id) throw new ClassChartsAuthError("Session expired.");
    this.sessionId = id;
    this.refreshedAt = this.now();
    this.persist();
  }

  private async request<T, M = unknown>(path: string): Promise<ApiResponse<T, M>> {
    if (this.auth) await this.auth;
    if (!this.sessionId) await this.once(() => this.login());
    else if (this.now() - this.refreshedAt > REFRESH_AFTER_MS) {
      // Cached or idle session: ping to rotate it; log in only if that fails.
      await this.once(() => this.refresh().catch(() => this.login()));
    }
    const used = this.sessionId;
    const logins = this.logins;
    let res = await this.raw<T, M>(path);
    if (res.refused) {
      if (this.sessionId === used) {
        // Is it the session? Ping first (cheap, no password). Only a dead session earns a login,
        // so refusals for other reasons don't feed ClassCharts' login rate limit.
        await this.once(() => this.refresh().catch(() => this.login()));
        if (this.logins === logins) throw refusedError(path, res.error); // session was fine
      }
      // A new session (ours or another request's): retry once with it.
      res = await this.raw<T, M>(path);
      if (res.refused) throw refusedError(path, res.error);
    }
    return res.body;
  }

  /** Fetch a list endpoint. A missing or malformed list is an error, never "nothing there". */
  private async list<T, M = unknown>(path: string): Promise<{ data: T[]; meta: M }> {
    const res = await this.request<T[], M>(path);
    if (!Array.isArray(res.data)) throw unexpected(path);
    return { data: res.data, meta: res.meta };
  }

  async pupils(): Promise<RawPupil[]> {
    return (await this.list<RawPupil>("/pupils")).data;
  }

  async homeworks(
    pupilId: number,
    opts: { from: string; to: string; by?: "due_date" | "issue_date" },
  ): Promise<RawHomework[]> {
    const q = new URLSearchParams({ display_date: opts.by ?? "due_date", from: opts.from, to: opts.to });
    return (await this.list<RawHomework>(`/homeworks/${pupilId}?${q}`)).data;
  }

  async timetable(pupilId: number, date: string): Promise<{ lessons: RawLesson[]; meta: TimetableMeta }> {
    const res = await this.list<RawLesson, TimetableMeta>(`/timetable/${pupilId}?date=${date}`);
    return { lessons: res.data, meta: res.meta };
  }

  async announcements(pupilId: number): Promise<RawAnnouncement[]> {
    return (await this.list<RawAnnouncement>(`/announcements/${pupilId}`)).data;
  }

  async detentions(pupilId: number): Promise<RawDetention[]> {
    return (await this.list<RawDetention>(`/detentions/${pupilId}`)).data;
  }

  /** Behaviour points, newest first, following ClassCharts' `last_id` pagination. */
  /** Up to `maxPages` pages of 10 points (500 by default: more than a school year for most pupils). */
  async activity(pupilId: number, range: { from: string; to: string }, maxPages = 50): Promise<RawActivityPoint[]> {
    const all: RawActivityPoint[] = [];
    let lastId: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const q = new URLSearchParams(range);
      if (lastId) q.set("last_id", lastId);
      // meta.last_id is unreliable (false on page one); page by the last item's id until empty.
      const batch = (await this.list<RawActivityPoint>(`/activity/${pupilId}?${q}`)).data;
      if (batch.length === 0) break;
      all.push(...batch);
      lastId = String(batch[batch.length - 1].id);
    }
    return all;
  }

  async attendance(
    pupilId: number,
    range: { from: string; to: string },
  ): Promise<{ days: Record<string, Record<string, RawAttendanceSession>>; meta: AttendanceMeta }> {
    const q = new URLSearchParams(range);
    const res = await this.request<Record<string, Record<string, RawAttendanceSession>>, AttendanceMeta>(
      `/attendance/${pupilId}?${q}`,
    );
    const days = res.data;
    // An empty range comes back as [] (PHP's empty array); anything else must be an object.
    if (Array.isArray(days) && days.length === 0) return { days: {}, meta: res.meta };
    if (!days || typeof days !== "object" || Array.isArray(days)) throw unexpected(`/attendance/${pupilId}`);
    return { days, meta: res.meta };
  }
}

interface Reply<T, M> {
  refused: boolean;
  error?: string;
  body: ApiResponse<T, M>;
}

const refusedError = (path: string, error?: string) =>
  new Error(`ClassCharts refused ${path.split("?")[0]}: ${error || "no reason given"}.`);

const unexpected = (path: string) =>
  new Error(`ClassCharts sent an unexpected response for ${path.split("?")[0]}; it may have changed. Not treating it as empty.`);
