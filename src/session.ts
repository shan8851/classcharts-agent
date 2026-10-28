// Cache the ClassCharts session on disk so each CLI run doesn't log in again.
// ClassCharts rate-limits logins ("Too many attempts"), and agents call the CLI often.

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Session {
  cookie: string;
  sessionId: string;
  refreshedAt: number;
}

export interface SessionStore {
  load(): Session | null;
  save(session: Session): void;
  clear(): void;
}

export function defaultSessionPath(): string {
  if (process.env.CLASSCHARTS_SESSION_FILE) return process.env.CLASSCHARTS_SESSION_FILE;
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cache, "classcharts-agent", "session.json");
}

/** File-backed store, readable only by the current user, keyed to the account's email. */
export function fileSessionStore(email: string, path = defaultSessionPath()): SessionStore {
  const account = createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
  return {
    load() {
      try {
        const data = JSON.parse(readFileSync(path, "utf8"));
        if (data.account !== account || !data.sessionId || !data.cookie) return null;
        return { cookie: data.cookie, sessionId: data.sessionId, refreshedAt: Number(data.refreshedAt) || 0 };
      } catch {
        return null;
      }
    },
    save(session) {
      try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, JSON.stringify({ account, ...session }), { mode: 0o600 });
        chmodSync(path, 0o600);
      } catch {
        // Caching is best effort; the CLI still works without it.
      }
    },
    clear() {
      rmSync(path, { force: true });
    },
  };
}

export const memorySessionStore = (): SessionStore => {
  let s: Session | null = null;
  return { load: () => s, save: (v) => void (s = v), clear: () => void (s = null) };
};
