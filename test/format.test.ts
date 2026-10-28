import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cleanRoom,
  parsePeriod,
  renderDay,
  renderHomeworkList,
  stripHtml,
  toDay,
  toHomework,
  toLesson,
} from "../src/format.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const SCHOOL = "Example School";

describe("lessons", () => {
  const tt = fixture("timetable-2026-10-21.json");

  it("reads the timetable week from encoded period names", () => {
    expect(parsePeriod("wednesday - 08:30:00 - 08:50:00 - 2")).toEqual({ week: 2, period: null });
    expect(parsePeriod("Period 3")).toEqual({ week: null, period: "Period 3" });
  });

  it("strips the school prefix from rooms only", () => {
    expect(cleanRoom("EXAMPLE SCHOOL: 119 Sci", SCHOOL)).toBe("119 Sci");
    expect(cleanRoom("1: 005G", SCHOOL)).toBe("1: 005G");
    expect(cleanRoom("", SCHOOL)).toBeNull();
  });

  it("normalises a real lesson", () => {
    expect(toLesson(tt.data[1], SCHOOL)).toMatchObject({
      date: "2026-10-21",
      start: "08:50",
      end: "09:50",
      subject: "Science",
      room: "119 Sci",
      week: 2,
      note: null,
    });
  });

  it("renders a school day and a holiday", () => {
    const day = toDay("2026-10-21", tt.data, tt.meta, [], SCHOOL);
    const text = renderDay(day);
    expect(text).toContain("Wednesday 2026-10-21 · week 2");
    expect(text).toContain("08:30–14:45, 6 lessons");

    const hol = fixture("timetable-2026-10-28.json");
    const holiday = toDay("2026-10-28", hol.data, hol.meta, [], SCHOOL);
    expect(holiday.schoolDay).toBe(false);
    expect(renderDay(holiday)).toContain("No lessons");
  });
});

describe("homework", () => {
  const raw = fixture("homeworks.json").data;
  const [geo, art] = raw.map(toHomework);

  it("uses ticked for done when the school leaves state null", () => {
    expect(geo.done).toBe(true);
    expect(geo.state).toBeNull();
    expect(art.done).toBe(false);
  });

  it("extracts minutes, links and attachments", () => {
    expect(geo.minutes).toBe(20);
    expect(geo.links).toEqual(["https://my.educake.co.uk/student-login"]);
    expect(art.attachments[0].name).toMatch(/\.docx$/);
  });

  it("turns HTML descriptions into plain text", () => {
    expect(geo.description).not.toMatch(/<|&nbsp;/);
    expect(geo.description.startsWith("Educake homework")).toBe(true);
    expect(stripHtml("<p>a&nbsp;&amp;&nbsp;b</p><ul><li>one</li></ul>")).toBe("a & b\n- one");
  });

  it("renders a compact list, todo count first", () => {
    const text = renderHomeworkList([art, geo]);
    expect(text.split("\n")[0]).toBe("2 homework (1 todo):");
    expect(text).toMatch(/\[done\] due Tue 2026-10-27 · Geography: Educake \(20 min/);
    expect(text).not.toContain("attachment:");
    expect(renderHomeworkList([art], { full: true })).toContain("attachment:");
  });

  it("attaches homework to the day it is due", () => {
    const day = toDay("2026-11-04", [], undefined, [geo, art], SCHOOL);
    expect(day.homeworkDue.map((h) => h.subject)).toEqual(["Art and Design / Art"]);
  });
});
