import { describe, expect, it } from "vitest";
import { addDays, nextSchoolDay, resolveDate, schoolWeek, todayIn } from "../src/dates.ts";

describe("dates", () => {
  it("todayIn uses the school's timezone", () => {
    // 23:30 UTC on 31 Mar 2026 is already 1 Apr in London (BST)
    expect(todayIn("Europe/London", new Date("2026-03-31T23:30:00Z"))).toBe("2026-04-01");
  });

  it("addDays crosses months and clock changes", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("nextSchoolDay skips weekends", () => {
    expect(nextSchoolDay("2026-10-30")).toBe("2026-11-02"); // Fri → Mon
    expect(nextSchoolDay("2026-10-28")).toBe("2026-10-29");
  });

  it("schoolWeek returns Mon–Fri, rolling weekends forward", () => {
    expect(schoolWeek("2026-10-28")).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    expect(schoolWeek("2026-10-31")[0]).toBe("2026-11-02");
  });

  it("resolveDate understands words and weekdays", () => {
    const today = "2026-10-28"; // Wednesday
    expect(resolveDate(undefined, today)).toBe(today);
    expect(resolveDate("tomorrow", today)).toBe("2026-10-29");
    expect(resolveDate("next", "2026-10-30")).toBe("2026-11-02");
    expect(resolveDate("wednesday", today)).toBe(today);
    expect(resolveDate("mon", today)).toBe("2026-11-02");
    expect(resolveDate("2026-11-04", today)).toBe("2026-11-04");
    expect(() => resolveDate("someday", today)).toThrow(/Can't read date/);
  });
});
