// Minimal read-only ClassCharts parent client.
// Reference: classchartsapi/classcharts-api-js (ISC) and its unofficial docs.
// Deliberately exposes no write endpoints (no password change, behaviour, ticking).

import { memorySessionStore, type SessionStore } from "./session.ts";
import type { ApiResponse, RawHomework, RawLesson, RawPupil, TimetableMeta } from "./types.ts";

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
        throw new ClassChartsAuthError(
          "ClassCharts is refusing logins for now (too many attempts). Wait a few minutes and try again.",
        );
      }
      throw new ClassChartsAuthError(
        `Login failed (HTTP ${res.status}). Check the parent email/password; ` +
          "if they're right, ClassCharts may have changed its login flow.",
      );
    }
    this.cookie = pairs.join("; ");
    const value = decodeURIComponent(creds.slice(creds.indexOf("=") + 1));
    this.sessionId = JSON.parse(value).session_id;
    this.refreshedAt = this.now();
    this.persist();
  }

  private async raw<T, M>(path: string, init: RequestInit = {}): Promise<ApiResponse<T, M>> {
    const res = await this.fetch(`${API}${path}`, {
      ...init,
      headers: {
        Cookie: this.cookie,
        Authorization: `Basic ${this.sessionId}`,
        "User-Agent": USER_AGENT,
      },
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`ClassCharts returned HTTP ${res.status} without JSON for ${path}.`);
    }
  }

  private async refresh(): Promise<void> {
    const body = new URLSearchParams({ include_data: "true" });
    const ping = await this.raw<unknown, { session_id?: string }>("/ping", { method: "POST", body });
    if (ping.success === 0 || !ping.meta?.session_id) throw new ClassChartsAuthError("Session expired.");
    this.sessionId = ping.meta.session_id;
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
    let res = await this.raw<T, M>(path);
    if (res.success === 0) {
      // Session rejected: log in once (unless another request already did), then retry.
      if (this.sessionId === used) await this.once(() => this.login());
      res = await this.raw<T, M>(path);
      if (res.success === 0) throw new Error(`ClassCharts error for ${path}: ${res.error ?? "unknown"}`);
    }
    return res;
  }

  async pupils(): Promise<RawPupil[]> {
    return (await this.request<RawPupil[]>("/pupils")).data ?? [];
  }

  async homeworks(
    pupilId: number,
    opts: { from: string; to: string; by?: "due_date" | "issue_date" },
  ): Promise<RawHomework[]> {
    const q = new URLSearchParams({ display_date: opts.by ?? "due_date", from: opts.from, to: opts.to });
    return (await this.request<RawHomework[]>(`/homeworks/${pupilId}?${q}`)).data ?? [];
  }

  async timetable(pupilId: number, date: string): Promise<{ lessons: RawLesson[]; meta: TimetableMeta }> {
    const res = await this.request<RawLesson[], TimetableMeta>(`/timetable/${pupilId}?date=${date}`);
    return { lessons: res.data ?? [], meta: res.meta };
  }
}
