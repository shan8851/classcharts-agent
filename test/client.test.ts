import { describe, expect, it } from "vitest";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClassChartsAuthError, ClassChartsClient } from "../src/client.ts";
import { fileSessionStore, memorySessionStore } from "../src/session.ts";

const creds = encodeURIComponent(JSON.stringify({ session_id: "sess-1" }));

function loginResponse(ok = true) {
  const headers = new Headers({ location: "https://www.classcharts.com/mobile/parent" });
  if (ok) {
    headers.append("set-cookie", `parent_session_credentials=${creds}; expires=Wed, 28 Oct 2026 10:00:00 GMT; path=/`);
    headers.append("set-cookie", "laravel_session=abc; path=/; httponly");
  } else {
    headers.append("set-cookie", "laravel_session=abc; path=/");
  }
  return new Response(null, { status: ok ? 302 : 200, headers });
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

describe("ClassChartsClient", () => {
  it("logs in, keeps cookie name=value pairs and sends the session id", async () => {
    const { fn, calls } = mockFetch((url) =>
      url.endsWith("/parent/login") ? loginResponse() : json({ success: 1, data: [{ id: 1 }], meta: {} }),
    );
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
    await client.pupils();

    const api = calls[1].init.headers as Record<string, string>;
    expect(api.Authorization).toBe("Basic sess-1");
    // Multiple Set-Cookie headers containing commas (expires=) must not break parsing
    expect(api.Cookie).toBe(`parent_session_credentials=${creds}; laravel_session=abc`);
    expect(calls[1].url).toBe("https://www.classcharts.com/apiv2parent/pupils");
  });

  it("throws an auth error on bad credentials", async () => {
    const { fn } = mockFetch(() => loginResponse(false));
    const client = new ClassChartsClient({ email: "e", password: "wrong", fetch: fn });
    await expect(client.pupils()).rejects.toBeInstanceOf(ClassChartsAuthError);
  });

  it("refreshes the session via ping after a few minutes", async () => {
    let t = 0;
    const { fn, calls } = mockFetch((url) => {
      if (url.endsWith("/parent/login")) return loginResponse();
      if (url.endsWith("/ping")) return json({ success: 1, data: {}, meta: { session_id: "sess-2" } });
      return json({ success: 1, data: [], meta: {} });
    });
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn, now: () => t });
    await client.pupils();
    t = 200_000;
    await client.timetable(1, "2026-10-21");

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/parent/login",
      "/apiv2parent/pupils",
      "/apiv2parent/ping",
      "/apiv2parent/timetable/1",
    ]);
    expect((calls[3].init.headers as Record<string, string>).Authorization).toBe("Basic sess-2");
  });

  it("logs in again once if the session was rejected", async () => {
    let first = true;
    const { fn, calls } = mockFetch((url) => {
      if (url.endsWith("/parent/login")) return loginResponse();
      if (first) {
        first = false;
        return json({ success: 0, error: "Session expired" });
      }
      return json({ success: 1, data: [{ id: 7 }], meta: {} });
    });
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
    expect(await client.pupils()).toEqual([{ id: 7 }]);
    expect(calls.filter((c) => c.url.endsWith("/parent/login"))).toHaveLength(2);
  });

  it("builds the homework query", async () => {
    const { fn, calls } = mockFetch((url) =>
      url.endsWith("/parent/login") ? loginResponse() : json({ success: 1, data: [], meta: {} }),
    );
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
    await client.homeworks(42, { from: "2026-10-21", to: "2026-11-11" });
    expect(calls[1].url).toBe(
      "https://www.classcharts.com/apiv2parent/homeworks/42?display_date=due_date&from=2026-10-21&to=2026-11-11",
    );
  });

  it("pages activity by the last item's id until an empty page", async () => {
    const pages = [[{ id: 30 }, { id: 29 }], [{ id: 28 }], []];
    const { fn, calls } = mockFetch((url) => {
      if (url.endsWith("/parent/login")) return loginResponse();
      // meta.last_id is false on the first page in real responses; it must not stop paging
      return json({ success: 1, data: pages.shift(), meta: { last_id: false } });
    });
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
    const points = await client.activity(1, { from: "2026-10-01", to: "2026-10-28" });
    expect(points.map((p) => p.id)).toEqual([30, 29, 28]);
    const lastIds = calls.slice(1).map((c) => new URL(c.url).searchParams.get("last_id"));
    expect(lastIds).toEqual([null, "29", "28"]);
  });

  it("doesn't log in again when the session is fine but a request is refused", async () => {
    const { fn, calls } = mockFetch((url) => {
      if (url.endsWith("/parent/login")) return loginResponse();
      if (url.endsWith("/ping")) return json({ success: 1, data: {}, meta: { session_id: "sess-2" } });
      if (url.includes("/detentions/")) return json({ success: 0, error: "Not allowed" });
      return json({ success: 1, data: [], meta: {} });
    });
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
    await expect(client.detentions(1)).rejects.toThrow(/refused \/detentions\/1: Not allowed/);
    expect(calls.filter((c) => c.url.endsWith("/parent/login"))).toHaveLength(1); // the first one only
    expect(calls.map((c) => new URL(c.url).pathname)).toContain("/apiv2parent/ping");
  });

  it("treats HTTP errors as errors without logging in again", async () => {
    const { fn, calls } = mockFetch((url) =>
      url.endsWith("/parent/login") ? loginResponse() : new Response("Service Unavailable", { status: 503 }),
    );
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
    await expect(client.homeworks(1, { from: "a", to: "b" })).rejects.toThrow(/HTTP 503/);
    expect(calls.filter((c) => c.url.endsWith("/parent/login"))).toHaveLength(1);
  });

  it("never turns a malformed reply into an empty list", async () => {
    const replies = [{ success: 1 }, { success: 1, data: null }, { success: 1, data: { not: "a list" } }];
    for (const reply of replies) {
      const { fn } = mockFetch((url) => (url.endsWith("/parent/login") ? loginResponse() : json(reply)));
      const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
      await expect(client.timetable(1, "2026-10-21")).rejects.toThrow(/unexpected response/);
    }
  });

  it("accepts an empty list and an empty attendance range", async () => {
    const { fn } = mockFetch((url) =>
      url.endsWith("/parent/login") ? loginResponse() : json({ success: 1, data: [], meta: {} }),
    );
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
    expect((await client.timetable(1, "2026-10-28")).lessons).toEqual([]);
    expect((await client.attendance(1, { from: "a", to: "b" })).days).toEqual({});
  });

  it("treats HTTP 401 as a refusal and logs in again when the session is dead", async () => {
    let first = true;
    const { fn, calls } = mockFetch((url) => {
      if (url.endsWith("/parent/login")) return loginResponse();
      if (url.endsWith("/ping")) return new Response("", { status: 401 });
      if (first) {
        first = false;
        return new Response("", { status: 401 });
      }
      return json({ success: 1, data: [{ id: 7 }], meta: {} });
    });
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
    expect(await client.pupils()).toEqual([{ id: 7 }]);
    expect(calls.filter((c) => c.url.endsWith("/parent/login"))).toHaveLength(2);
  });

  it("reuses a cached session without logging in", async () => {
    const store = memorySessionStore();
    store.save({ cookie: "c=1", sessionId: "cached", refreshedAt: 1_000 });
    const { fn, calls } = mockFetch(() => json({ success: 1, data: [], meta: {} }));
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn, now: () => 2_000, session: store });
    await client.pupils();
    expect(calls).toHaveLength(1);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Basic cached");
  });

  it("pings a stale cached session and saves the rotated id", async () => {
    const store = memorySessionStore();
    store.save({ cookie: "c=1", sessionId: "old", refreshedAt: 0 });
    const { fn, calls } = mockFetch((url) =>
      url.endsWith("/ping")
        ? json({ success: 1, data: {}, meta: { session_id: "new" } })
        : json({ success: 1, data: [], meta: {} }),
    );
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn, now: () => 10_000_000, session: store });
    await client.pupils();
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/apiv2parent/ping", "/apiv2parent/pupils"]);
    expect(store.load()?.sessionId).toBe("new");
  });

  it("parallel requests share one login", async () => {
    const { fn, calls } = mockFetch((url) =>
      url.endsWith("/parent/login") ? loginResponse() : json({ success: 1, data: [], meta: {} }),
    );
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
    await Promise.all([1, 2, 3, 4, 5].map((i) => client.timetable(1, `2026-10-2${i}`)));
    expect(calls.filter((c) => c.url.endsWith("/parent/login"))).toHaveLength(1);
  });

  it("parallel requests on a rejected cached session share one login", async () => {
    const store = memorySessionStore();
    store.save({ cookie: "c=1", sessionId: "dead", refreshedAt: Date.now() });
    const { fn, calls } = mockFetch((url, init) => {
      if (url.endsWith("/parent/login")) return loginResponse();
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Basic dead" ? json({ success: 0, error: "Session expired" }) : json({ success: 1, data: [], meta: {} });
    });
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn, session: store });
    await Promise.all([1, 2, 3, 4, 5].map((i) => client.timetable(1, `2026-10-2${i}`)));
    expect(calls.filter((c) => c.url.endsWith("/parent/login"))).toHaveLength(1);
    expect(store.load()?.sessionId).toBe("sess-1");
  });

  it("gives up after one fresh login instead of looping", async () => {
    const { fn, calls } = mockFetch((url) =>
      url.endsWith("/parent/login") ? loginResponse() : json({ success: 0, error: "Nope" }),
    );
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
    await expect(client.pupils()).rejects.toThrow(/Nope/);
    expect(calls.filter((c) => c.url.endsWith("/parent/login"))).toHaveLength(2);
  });

  it("reports a malformed login cookie as an auth error", async () => {
    const { fn } = mockFetch(() => {
      const headers = new Headers({ location: "/mobile/parent" });
      headers.append("set-cookie", "parent_session_credentials=not-json; path=/");
      return new Response(null, { status: 302, headers });
    });
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
    await expect(client.pupils()).rejects.toThrow(/not understood/);
  });

  it("explains the login rate limit", async () => {
    const { fn } = mockFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://www.classcharts.com/parent/login", "set-cookie": "cc-session=x" },
        }),
    );
    const client = new ClassChartsClient({ email: "e", password: "p", fetch: fn });
    await expect(client.pupils()).rejects.toThrow(/too many attempts.*wrong/);
  });
});

describe("fileSessionStore", () => {
  it("round-trips per account with private permissions", () => {
    const path = join(mkdtempSync(join(tmpdir(), "cc-")), "s", "session.json");
    const a = fileSessionStore("Parent@Example.com", path);
    a.save({ cookie: "c", sessionId: "s", refreshedAt: 5 });
    expect(fileSessionStore("parent@example.com", path).load()).toEqual({ cookie: "c", sessionId: "s", refreshedAt: 5 });
    expect(fileSessionStore("other@example.com", path).load()).toBeNull();
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("ignores a corrupt session file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "cc-")), "session.json");
    writeFileSync(path, "{not json");
    expect(fileSessionStore("e", path).load()).toBeNull();
  });
});
