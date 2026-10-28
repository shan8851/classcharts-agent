// Runs the real CLI against a fake ClassCharts built from the fixtures. No network, no real login.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClassChartsAuthError } from "../src/client.ts";
import { exitCode, main, pickPupil } from "../src/cli.ts";
import type { RawPupil } from "../src/types.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const TODAY = new Date("2026-10-28T18:00:00Z"); // Wednesday evening, half-term
const creds = encodeURIComponent(JSON.stringify({ session_id: "s1" }));

interface World {
  pupil: Partial<RawPupil>;
  extraHomework: object[];
  schoolDays: Set<string>;
  calls: string[];
}
let world: World;

const json = (body: unknown) => new Response(JSON.stringify(body));

function fakeClassCharts(url: string): Response {
  const u = new URL(url);
  world.calls.push(u.pathname);
  if (u.pathname === "/parent/login") {
    const headers = new Headers({ location: "https://www.classcharts.com/mobile/parent" });
    headers.append("set-cookie", `parent_session_credentials=${creds}; path=/`);
    return new Response(null, { status: 302, headers });
  }
  const path = u.pathname.replace("/apiv2parent", "").split("/")[1];
  const q = u.searchParams;
  switch (path) {
    case "pupils": {
      const p = fixture("pupils.json");
      p.data[0] = { ...p.data[0], ...world.pupil };
      return json(p);
    }
    case "homeworks": {
      const h = fixture("homeworks.json");
      const all = [...h.data, ...world.extraHomework];
      // Like the real API with display_date=due_date: filter on the due date.
      h.data = all.filter((x: { due_date: string }) => x.due_date >= q.get("from")! && x.due_date <= q.get("to")!);
      return json(h);
    }
    case "timetable": {
      const tt = fixture("timetable-2026-10-21.json");
      if (!world.schoolDays.has(q.get("date")!)) tt.data = [];
      return json(tt);
    }
    case "activity": {
      const a = fixture("activity.json");
      if (q.get("last_id")) a.data = [];
      return json(a);
    }
    case "announcements":
    case "detentions":
    case "attendance":
      return json(fixture(`${path}.json`));
    default:
      return json({ success: 0, error: `fake: no route for ${u.pathname}` });
  }
}

const run = (...argv: string[]) => main(argv, { envFiles: [] });
const runJson = async (...argv: string[]) => JSON.parse(await run(...argv, "--json"));

beforeEach(() => {
  world = { pupil: {}, extraHomework: [], schoolDays: new Set(["2026-11-02", "2026-11-03"]), calls: [] };
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  vi.stubGlobal("fetch", async (url: string) => fakeClassCharts(url));
  vi.stubEnv("CLASSCHARTS_EMAIL", "parent@example.com");
  vi.stubEnv("CLASSCHARTS_PASSWORD", "secret");
  vi.stubEnv("CLASSCHARTS_PUPIL", "");
  vi.stubEnv("CLASSCHARTS_SESSION_FILE", join(mkdtempSync(join(tmpdir(), "cc-cli-")), "session.json"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("digest", () => {
  it("includes overdue homework that isn't ticked off", async () => {
    world.extraHomework = [
      { ...fixture("homeworks.json").data[1], id: 99, title: "Overdue maths", due_date: "2026-10-20" },
    ];
    const d = await runJson("digest");
    expect(d.homeworkTodo.map((h: { title: string }) => h.title)).toEqual([
      "Overdue maths",
      "Literacy- Spellings and definitions",
    ]);
    expect(await run("digest")).toMatch(/Homework to do \(due by 2026-11-11, 1 overdue\)/);
  });

  it("skips half-term to the next day with lessons", async () => {
    const d = await runJson("digest");
    expect(d.nextSchoolDay.date).toBe("2026-11-02");
    expect(await run("digest")).toContain("Next school day · Monday 2026-11-02 · week 2");
  });

  it("collects every section and only recent announcements", async () => {
    const d = await runJson("digest");
    expect(d.pupil).toEqual({ id: 1001, name: "Alex Example", school: "Example School" });
    expect(d.detentions.map((x: { date: string }) => x.date)).toEqual(["2026-11-03"]);
    expect(d.announcementsLast7Days.map((a: { title: string }) => a.title)).toEqual([
      "Head of School Bulletin - Friday 23rd October",
    ]);
    expect(d.behaviourLast7Days.positive.count).toBe(0); // fixture points are before the 7-day window
    expect(d.attendanceThisYear.percentage).toBe(87.5);
    expect(d.hiddenBySchool).toEqual([]);
  });

  it("leaves out sections the school hides", async () => {
    world.pupil = { display_announcements: false, display_attendance: false };
    const d = await runJson("digest");
    expect(d.hiddenBySchool).toEqual(["announcements", "attendance"]);
    expect(d.announcementsLast7Days).toBeNull();
    const text = await run("digest");
    expect(text).not.toContain("Announcements");
    expect(world.calls).not.toContain("/apiv2parent/announcements/1001");
  });

  it("says when there's no school day in the next three weeks", async () => {
    world.schoolDays = new Set();
    expect((await runJson("digest")).nextSchoolDay).toBeNull();
    expect(await run("digest")).toContain("No lessons found in the next three weeks.");
  });
});

describe("commands", () => {
  it("returns valid JSON for a section the school hides", async () => {
    world.pupil = { display_announcements: false };
    const out = await runJson("announcements");
    expect(out.hiddenBySchool).toBe("announcements");
  });

  it("day next skips holidays and reports how many", async () => {
    const d = await runJson("day", "next");
    expect(d).toMatchObject({ date: "2026-11-02", schoolDay: true, skippedDays: 2 });
  });

  it("behaviour totals match the listed points", async () => {
    const b = await runJson("behaviour", "--from", "2026-10-01");
    expect(b.points).toHaveLength(5);
    expect(b.positive.count + b.negative.count).toBe(b.points.length);
  });

  it("ignores a stray date argument on commands that don't take one", async () => {
    await expect(run("pupils", "tomorrow")).resolves.toContain("Alex Example");
  });

  it("rejects bad input before touching the network", async () => {
    await expect(run("day", "2026-13-45")).rejects.toThrow(/isn't a real date/);
    await expect(run("nonsense")).rejects.toThrow(/Unknown command/);
    expect(world.calls).toEqual([]);
  });

  it("logs in once and reuses the cached session", async () => {
    await run("digest");
    await run("detentions");
    expect(world.calls.filter((c) => c === "/parent/login")).toHaveLength(1);
  });

  it("works without a login for help, version and skill", async () => {
    vi.stubEnv("CLASSCHARTS_EMAIL", "");
    expect(await run("--version")).toMatch(/^\d+\.\d+\.\d+$/);
    expect(await run("skill")).toMatch(/^---\nname: classcharts/);
    expect(await run("--help")).toContain("Usage: classcharts");
    expect(world.calls).toEqual([]);
  });
});

describe("errors and exit codes", () => {
  it("no login is an auth error (exit 2)", async () => {
    vi.stubEnv("CLASSCHARTS_PASSWORD", "");
    const err = await run("digest").catch((e) => e);
    expect(err).toBeInstanceOf(ClassChartsAuthError);
    expect(err.message).toMatch(/classcharts setup/);
    expect(exitCode(err)).toBe(2);
    expect(exitCode(new Error("other"))).toBe(1);
  });
});

describe("pickPupil", () => {
  const kids = [
    { id: 1, name: "Sam One", first_name: "Sam" },
    { id: 2, name: "Sam Two", first_name: "Sam" },
    { id: 3, name: "Ali Three", first_name: "Ali" },
  ] as RawPupil[];

  it("never guesses when several children are linked", () => {
    expect(() => pickPupil(kids)).toThrow(/More than one child is linked.*--pupil/);
    expect(() => pickPupil(kids, " ")).toThrow(/More than one child/);
    expect(pickPupil([kids[2]]).id).toBe(3); // one child: no need to choose
  });

  it("matches by id, first name or full name", () => {
    expect(pickPupil(kids, "2").id).toBe(2);
    expect(pickPupil(kids, "ali").id).toBe(3);
    expect(pickPupil(kids, "Sam Two").id).toBe(2);
  });

  it("refuses ambiguous or unknown names", () => {
    expect(() => pickPupil(kids, "sam")).toThrow(/More than one pupil/);
    expect(() => pickPupil(kids, "bob")).toThrow(/No pupil matching/);
    expect(() => pickPupil([])).toThrow(/No children/);
  });
});
