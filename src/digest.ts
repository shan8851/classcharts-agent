// `classcharts digest`: everything worth knowing, in one call.

import type { ClassChartsClient } from "./client.ts";
import { addDays, longDate, nextSchoolDay, schoolYearStart } from "./dates.ts";
import { type Day, heading, type Homework, renderHomework, type Style, toDay, toHomework } from "./format.ts";
import {
  renderAnnouncement,
  renderAttendanceLine,
  renderBehaviourLine,
  renderDetentions,
  summarisePoints,
  toAnnouncement,
  toAttendance,
  toDetention,
  toPoint,
} from "./sections.ts";
import type { RawPupil } from "./types.ts";

/** How far back the digest looks for homework that's still not ticked off. */
export const OVERDUE_DAYS = 14;
/** Weekdays to walk past when looking for the next day with lessons (covers Christmas). */
const MAX_SKIP = 15;

/** The next day with lessons after `from`, or null if none in ~3 school weeks. */
export async function nextDayWithLessons(client: ClassChartsClient, pupilId: number, from: string) {
  let date = from;
  for (let skipped = 0; skipped <= MAX_SKIP; skipped++) {
    date = nextSchoolDay(date);
    const tt = await client.timetable(pupilId, date);
    if (tt.lessons.length > 0) return { date, lessons: tt.lessons, skipped };
  }
  return null;
}

/** "PSHE ×2, Design and Technology ×2, Geography" */
export function lessonSummary(day: Day): string {
  const runs: { subject: string; n: number }[] = [];
  for (const l of day.lessons) {
    const last = runs[runs.length - 1];
    if (last?.subject === l.subject) last.n++;
    else runs.push({ subject: l.subject, n: 1 });
  }
  return runs.map((r) => (r.n > 1 ? `${r.subject} ×${r.n}` : r.subject)).join(", ");
}

export async function digest(client: ClassChartsClient, pupil: RawPupil, today: string, tz: string, s: Style) {
  const weekAgo = addDays(today, -6);
  const hwRange = { from: addDays(today, -OVERDUE_DAYS), to: addDays(today, 14) };
  const yearStart = schoolYearStart(today);
  const on = (flag: boolean | undefined) => flag !== false;

  const [next, hw, detentions, points, announcements, attendance] = await Promise.all([
    on(pupil.display_timetable) ? nextDayWithLessons(client, pupil.id, today) : undefined,
    on(pupil.display_homework) ? client.homeworks(pupil.id, hwRange) : undefined,
    on(pupil.display_detentions) ? client.detentions(pupil.id) : undefined,
    on(pupil.display_behaviour) ? client.activity(pupil.id, { from: weekAgo, to: today }) : undefined,
    on(pupil.display_announcements) ? client.announcements(pupil.id) : undefined,
    on(pupil.display_attendance) ? client.attendance(pupil.id, { from: yearStart, to: today }) : undefined,
  ]);

  // undefined = the school hides this section; null (next day only) = none found.
  const homework = hw?.map(toHomework).sort((a, b) => a.due.localeCompare(b.due));
  const todo = homework?.filter((h) => !h.done);
  const nextDay = next && toDay(next.date, next.lessons, homework ?? [], pupil.school_name);
  const dets = detentions?.map((d) => toDetention(d, today, tz)).filter((d) => d.upcoming || d.date >= weekAgo);
  const beh = points && summarisePoints(points.map(toPoint).filter((p) => p.date >= weekAgo), weekAgo, today);
  const anns = announcements
    ?.map((a) => toAnnouncement(a, tz))
    .filter((a) => a.date >= weekAgo)
    .sort((a, b) => b.date.localeCompare(a.date));
  const att = attendance && toAttendance(attendance.days, attendance.meta, yearStart, today);

  const json = {
    date: today,
    nextSchoolDay: nextDay ?? null,
    homeworkTodo: todo ?? null,
    detentions: dets ?? null,
    behaviourLast7Days: beh ?? null,
    announcementsLast7Days: anns ?? null,
    attendanceThisYear: att ?? null,
    hiddenBySchool: [
      next === undefined && "timetable",
      hw === undefined && "homework",
      detentions === undefined && "detentions",
      points === undefined && "behaviour",
      announcements === undefined && "announcements",
      attendance === undefined && "attendance",
    ].filter(Boolean),
  };

  const lines = [longDate(today)];
  const section = (title: string, body: string) => lines.push("", heading(s, title), body);

  if (next === null) section("Next school day", "  No lessons found in the next three weeks.");
  else if (nextDay) {
    const week = nextDay.lessons.find((l) => l.week != null)?.week;
    const first = nextDay.lessons[0];
    const last = nextDay.lessons[nextDay.lessons.length - 1];
    section(
      `Next school day · ${longDate(nextDay.date)}${week ? ` · week ${week}` : ""}`,
      `  ${s("cyan", `${first.start}–${last.end}`)}  ${lessonSummary(nextDay)}`,
    );
  }
  if (todo) {
    const overdue = todo.filter((h) => h.due < today).length;
    section(
      `Homework to do (due by ${hwRange.to}${overdue ? `, ${overdue} overdue` : ""})`,
      todo.length ? todo.map((h: Homework) => `  ${renderHomework(h, { style: s })}`).join("\n") : "  Nothing outstanding.",
    );
  }
  if (dets) section("Detentions", dets.length ? indentLines(renderDetentions(dets, s)) : "  None.");
  if (beh) section("Behaviour (last 7 days)", `  ${renderBehaviourLine(beh, s)}`);
  if (anns) {
    section(
      "Announcements (last 7 days)",
      anns.length ? anns.map((a) => `  ${renderAnnouncement(a, { style: s, titleOnly: true })}`).join("\n") : "  None.",
    );
  }
  if (att) section("Attendance (this school year)", `  ${renderAttendanceLine(att, s)}`);

  return { json, text: lines.join("\n") };
}

const indentLines = (text: string) =>
  text
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
