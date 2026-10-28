import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  localDate,
  renderAnnouncement,
  renderAttendanceLine,
  renderBehaviour,
  renderBehaviourLine,
  renderDetentions,
  summarisePoints,
  toAnnouncement,
  toAttendance,
  toDetention,
  toPoint,
} from "../src/sections.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

describe("announcements", () => {
  const [bulletin, rail, trip] = fixture("announcements.json").data.map((a: never) => toAnnouncement(a));

  it("normalises text, dates and attachments", () => {
    expect(bulletin.date).toBe("2026-10-23");
    expect(bulletin.text).toBe("Dear Students and Parents/Carers\nPlease see attached, today's bulletin.\nWishing you all a wonderful half term break!");
    expect(bulletin.attachments).toEqual([{ name: "Bulletin.pdf", url: "https://files.example.invalid/bulletin.pdf" }]);
    expect(rail.pinned).toBe(false);
  });

  it("flags consent requests and pinned posts", () => {
    expect(trip).toMatchObject({ consentRequired: true, consentGiven: null, pinned: true });
    const text = renderAnnouncement(trip);
    expect(text).toContain("[pinned]");
    expect(text).toContain("[consent needed]");
    expect(renderAnnouncement(bulletin, { titleOnly: true })).toBe(
      "- Fri 2026-10-23 · Head of School Bulletin - Friday 23rd October (Mrs A Office) [1 attachment]",
    );
  });

  it("uses the school's timezone for the date", () => {
    expect(localDate("2026-10-22T23:30:00+00:00", "Europe/London")).toBe("2026-10-23");
  });
});

describe("behaviour", () => {
  const points = fixture("activity.json").data.map(toPoint);

  it("normalises points", () => {
    expect(points[0]).toMatchObject({ date: "2026-10-21", time: "11:05", polarity: "positive", reason: "Commendation", score: 1 });
    expect(points.at(-1)).toMatchObject({ polarity: "negative", reason: "S1", note: "Talking in class" });
  });

  it("summarises from the points so totals match the list", () => {
    const b = summarisePoints(points, "2026-10-15", "2026-10-21");
    expect(b.positive.count).toBe(4);
    expect(b.negative).toEqual({ count: 1, reasons: { S1: 1 } });
    expect(renderBehaviourLine(b)).toMatch(/^4 positive \(Commendation 3, Being Responsible 1\), 1 negative \(S1 1\)$/);
    expect(renderBehaviour(b, points)).toContain("-1 S1");
    expect(renderBehaviourLine(summarisePoints([], "a", "b"))).toBe("No behaviour points.");
  });
});

describe("detentions", () => {
  const list = fixture("detentions.json").data.map((d: never) => toDetention(d, "2026-10-28"));

  it("marks upcoming ones and reads the community schema", () => {
    expect(list[0]).toMatchObject({
      date: "2026-11-03",
      time: "15:00",
      minutes: 30,
      type: "After school",
      reason: "Homework not done",
      subject: "Mathematics",
      teacher: "Ms T Teacher",
      upcoming: true,
    });
    expect(list[1]).toMatchObject({ upcoming: false, status: "yes", teacher: null });
  });

  it("renders upcoming first", () => {
    const lines = renderDetentions(list).split("\n");
    expect(lines[0]).toMatch(/^- \[upcoming\] Tue 2026-11-03 15:00, 30 min, Room 12 · After school/);
    expect(lines[1]).toMatch(/\[attended\] Wed 2026-10-14/);
    expect(renderDetentions([])).toBe("No detentions.");
  });
});

describe("attendance", () => {
  const raw = fixture("attendance.json");
  const a = toAttendance(raw.data, raw.meta, "2026-10-17", "2026-10-21");

  it("ignores weekends and lists only sessions that weren't present", () => {
    expect(a.percentage).toBe(87.5);
    expect(a.issues).toEqual([{ date: "2026-10-20", session: "AM", status: "late", code: "L", lateMinutes: 12 }]);
    expect(renderAttendanceLine(a)).toBe("87.5% (since August 100%), 1 session not present");
  });
});
