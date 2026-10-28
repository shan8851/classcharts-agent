#!/usr/bin/env node
// classcharts: read-only ClassCharts CLI for agents (parent accounts).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, styleText } from "node:util";
import { ClassChartsAuthError, ClassChartsClient } from "./client.ts";
import { addDays, nextSchoolDay, resolveDate, schoolWeek, schoolYearStart, todayIn } from "./dates.ts";
import {
  type Day,
  heading,
  plain,
  type RenderOptions,
  renderDay,
  renderHomework,
  renderHomeworkList,
  type Style,
  toDay,
  toHomework,
} from "./format.ts";
import {
  renderAnnouncement,
  renderAttendance,
  renderAttendanceLine,
  renderBehaviour,
  renderBehaviourLine,
  renderDetentions,
  toAnnouncement,
  toAttendance,
  toDetention,
  summarisePoints,
  toPoint,
} from "./sections.ts";
import { fileSessionStore } from "./session.ts";
import { configEnvFile, setup } from "./setup.ts";
import type { RawPupil } from "./types.ts";

const HELP = `classcharts: read-only ClassCharts for a parent account

Usage: classcharts <command> [date] [options]

Commands:
  digest            Everything worth knowing: next school day, homework to do,
                    detentions, behaviour, announcements, attendance
  day [DATE]        Lessons + homework due that day (default: today)
  week [DATE]       Mon–Fri lessons + homework due that week (default: this week)
  homework          Homework by due date (default: 7 days ago → 21 days ahead)
  timetable [DATE]  Lessons only for one day
  announcements     School announcements (default: last 14 days)
  behaviour         Behaviour points (default: last 7 days)
  detentions        Upcoming and past detentions
  attendance        Attendance % and any absences/lates (default: this school year)
  pupils            Children linked to the account
  setup             Sign in once (run by a person; saves the login privately)
  skill             Print SKILL.md, the instructions for AI agents

DATE: YYYY-MM-DD, today, tomorrow, yesterday, next, or a weekday (mon, friday…)
      day/timetable next = next day with lessons (skips weekends and holidays)
      week next          = next week

Options:
  --pupil <id|name> Which child (default: CLASSCHARTS_PUPIL, else the first)
  --from <DATE>     Start of range (homework, announcements, behaviour, attendance)
  --to <DATE>       End of range
  --todo            homework: only items not marked done
  --full            Full text, links and attachments
  --json            JSON output instead of text
                    (text is coloured on a terminal, plain when piped; NO_COLOR respected)
  -v, --version
  -h, --help

Login: run \`classcharts setup\` once, or set CLASSCHARTS_EMAIL and CLASSCHARTS_PASSWORD
(optional CLASSCHARTS_PUPIL). Looked for in: the environment, CLASSCHARTS_ENV_FILE,
a .env in a cloned repo, then ~/.config/classcharts-agent/.env.
The session is cached in ~/.cache/classcharts-agent/ (override: CLASSCHARTS_SESSION_FILE),
because ClassCharts blocks repeated logins for a few minutes.`;

const COMMANDS = [
  "digest",
  "day",
  "week",
  "homework",
  "timetable",
  "announcements",
  "behaviour",
  "detentions",
  "attendance",
  "pupils",
  "setup",
  "skill",
];
const isNext = (s?: string) => s === "next" || s === "next-school-day";

/** Package root: works from src/ (clone) and dist/ (npm). */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  if (process.env.CLASSCHARTS_EMAIL && process.env.CLASSCHARTS_PASSWORD) return;
  const candidates = [process.env.CLASSCHARTS_ENV_FILE, join(ROOT, ".env"), configEnvFile()];
  const file = candidates.find((f): f is string => !!f && existsSync(f));
  if (file) process.loadEnvFile(file);
}

function pickPupil(pupils: RawPupil[], wanted?: string): RawPupil {
  if (pupils.length === 0) throw new Error("No children are linked to this ClassCharts account.");
  if (!wanted) return pupils[0];
  const w = wanted.trim().toLowerCase();
  const found = pupils.find(
    (p) => String(p.id) === w || p.first_name?.toLowerCase() === w || p.name?.toLowerCase() === w,
  );
  if (!found) {
    throw new Error(`No pupil matching "${wanted}". Linked: ${pupils.map((p) => `${p.first_name} (${p.id})`).join(", ")}`);
  }
  return found;
}

/** The next day with lessons after `from`, walking past holidays (up to 3 school weeks). */
async function nextDayWithLessons(client: ClassChartsClient, pupilId: number, from: string) {
  let date = nextSchoolDay(from);
  let tt = await client.timetable(pupilId, date);
  let skipped = 0;
  while (tt.lessons.length === 0 && skipped < 15) {
    date = nextSchoolDay(date);
    tt = await client.timetable(pupilId, date);
    skipped++;
  }
  return { date, tt, skipped };
}

/** "PSHE, Design and Technology ×2, Geography" */
function lessonSummary(day: Day): string {
  const out: string[] = [];
  let prev = "";
  let n = 0;
  for (const l of day.lessons) {
    if (l.subject === prev) n++;
    else {
      if (prev) out.push(n > 1 ? `${prev} ×${n}` : prev);
      prev = l.subject;
      n = 1;
    }
  }
  if (prev) out.push(n > 1 ? `${prev} ×${n}` : prev);
  return out.join(", ");
}

async function main(argv: string[]): Promise<string> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      pupil: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      todo: { type: "boolean" },
      full: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, dateArg] = positionals;
  // Colour only on a colour-capable terminal (hasColors respects NO_COLOR/FORCE_COLOR).
  // Checked here because Node 20's styleText doesn't check the stream itself.
  const colour = !!process.stdout.isTTY && process.stdout.hasColors?.() === true;
  const s: Style = colour ? (f, t) => styleText(f, t, { validateStream: false }) : plain;
  const render: RenderOptions = { full: values.full, style: s };
  if (values.version) return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  if (values.help || !command || command === "help") return HELP;
  // Fail on typos before touching the network (logins are rate-limited).
  if (!COMMANDS.includes(command)) throw new Error(`Unknown command "${command}".\n\n${HELP}`);
  for (const d of [dateArg, values.from, values.to]) if (d) resolveDate(d, todayIn("Europe/London"));
  if (command === "skill") return readFileSync(join(ROOT, "SKILL.md"), "utf8").trimEnd();
  if (command === "setup") return setup();

  loadEnv();
  if (!process.env.CLASSCHARTS_EMAIL || !process.env.CLASSCHARTS_PASSWORD) {
    throw new ClassChartsAuthError(
      "No ClassCharts login found. A person needs to run `classcharts setup` once " +
        "(or set CLASSCHARTS_EMAIL and CLASSCHARTS_PASSWORD).",
    );
  }
  const email = process.env.CLASSCHARTS_EMAIL ?? "";
  const client = new ClassChartsClient({
    email,
    password: process.env.CLASSCHARTS_PASSWORD ?? "",
    session: fileSessionStore(email),
  });

  const pupils = await client.pupils();
  if (command === "pupils") {
    const list = pupils.map((p) => ({
      id: p.id,
      name: p.name,
      school: p.school_name,
      homeworkTodo: p.homework_todo_count,
      homeworkLate: p.homework_late_count,
      sections: {
        timetable: p.display_timetable,
        homework: p.display_homework,
        behaviour: p.display_behaviour ?? null,
        detentions: p.display_detentions ?? null,
        announcements: p.display_announcements ?? null,
        attendance: p.display_attendance ?? null,
      },
    }));
    return values.json
      ? JSON.stringify(list, null, 2)
      : list
          .map((p) => {
            const on = Object.entries(p.sections).filter(([, v]) => v).map(([k]) => k).join(", ");
            return `${s("bold", p.name)} ${s("dim", `(${p.id})`)} · ${p.school}\n  homework todo ${p.homeworkTodo}, late ${p.homeworkLate}\n  ${s("dim", `sections: ${on}`)}`;
          })
          .join("\n");
  }

  const pupil = pickPupil(pupils, values.pupil ?? process.env.CLASSCHARTS_PUPIL);
  const tz = pupil.timezone || "Europe/London";
  const today = todayIn(tz);
  const who = { id: pupil.id, name: pupil.name, school: pupil.school_name };
  const out = (json: unknown, text: string) =>
    values.json ? JSON.stringify({ pupil: who, ...(json as object) }, null, 2) : `${s("bold", pupil.first_name)} · ${text}`;
  const from = (fallback: string) => resolveDate(values.from ?? fallback, today);
  const to = (fallback: string) => resolveDate(values.to ?? fallback, today);
  const hidden = (section: string) => `${pupil.first_name}'s school doesn't show ${section} in ClassCharts.`;

  switch (command) {
    case "homework": {
      const range = { from: from(addDays(today, -7)), to: to(addDays(today, 21)) };
      let list = (await client.homeworks(pupil.id, range)).map(toHomework);
      if (values.todo) list = list.filter((h) => !h.done);
      list.sort((a, b) => a.due.localeCompare(b.due));
      return out(
        { ...range, homework: list },
        `${heading(s, `Homework due ${range.from} → ${range.to}`)}\n${renderHomeworkList(list, render)}`,
      );
    }

    case "day":
    case "timetable": {
      let date = resolveDate(dateArg, today);
      let tt = await client.timetable(pupil.id, date);
      let skipped = 0;
      if (isNext(dateArg) && tt.lessons.length === 0) {
        const found = await nextDayWithLessons(client, pupil.id, date);
        ({ date, tt } = found);
        skipped = found.skipped + 1;
      }
      const hw = command === "day" ? await client.homeworks(pupil.id, { from: date, to: date }) : [];
      const day = toDay(date, tt.lessons, tt.meta, hw.map(toHomework), pupil.school_name);
      const note = skipped ? s("dim", `\n  (skipped ${skipped} weekday${skipped > 1 ? "s" : ""} with no lessons)`) : "";
      return out({ ...day, skippedDays: skipped }, renderDay(day, render) + note);
    }

    case "week": {
      const dates = schoolWeek(isNext(dateArg) ? addDays(today, 7) : resolveDate(dateArg, today));
      const [hw, ...tts] = await Promise.all([
        client.homeworks(pupil.id, { from: dates[0], to: dates[4] }),
        ...dates.map((d) => client.timetable(pupil.id, d)),
      ]);
      const homework = hw.map(toHomework);
      const days = dates.map((d, i) => toDay(d, tts[i].lessons, tts[i].meta, homework, pupil.school_name));
      return out(
        { from: dates[0], to: dates[4], days },
        `week of ${dates[0]}\n\n${days.map((d) => renderDay(d, render)).join("\n\n")}`,
      );
    }

    case "announcements": {
      if (pupil.display_announcements === false) return hidden("announcements");
      const range = { from: from(addDays(today, -14)), to: to(today) };
      const list = (await client.announcements(pupil.id))
        .map((a) => toAnnouncement(a, tz))
        .filter((a) => a.date >= range.from && a.date <= range.to)
        .sort((a, b) => b.date.localeCompare(a.date));
      const text = list.length ? list.map((a) => renderAnnouncement(a, render)).join("\n") : "No announcements in this range.";
      return out({ ...range, announcements: list }, `${heading(s, `Announcements ${range.from} → ${range.to}`)}\n${text}`);
    }

    case "behaviour": {
      if (pupil.display_behaviour === false) return hidden("behaviour");
      const range = { from: from(addDays(today, -6)), to: to(today) };
      const list = (await client.activity(pupil.id, range)).map(toPoint).filter((p) => p.date >= range.from && p.date <= range.to);
      const b = summarisePoints(list, range.from, range.to);
      return out({ ...b, points: list }, renderBehaviour(b, list, render));
    }

    case "detentions": {
      if (pupil.display_detentions === false) return hidden("detentions");
      const list = (await client.detentions(pupil.id)).map((d) => toDetention(d, today));
      return out({ detentions: list }, `${heading(s, "Detentions")}\n${renderDetentions(list, s)}`);
    }

    case "attendance": {
      if (pupil.display_attendance === false) return hidden("attendance");
      const range = { from: from(schoolYearStart(today)), to: to(today) };
      const { days, meta } = await client.attendance(pupil.id, range);
      const a = toAttendance(days, meta, range.from, range.to);
      return out(a, renderAttendance(a, render));
    }

    case "digest": {
      const weekAgo = addDays(today, -6);
      const hwRange = { from: today, to: addDays(today, 14) };
      const [next, hw, detentions, behaviour, announcements, attendance] = await Promise.all([
        pupil.display_timetable === false ? null : nextDayWithLessons(client, pupil.id, today),
        client.homeworks(pupil.id, hwRange),
        pupil.display_detentions === false ? null : client.detentions(pupil.id),
        pupil.display_behaviour === false ? null : client.activity(pupil.id, { from: weekAgo, to: today }),
        pupil.display_announcements === false ? null : client.announcements(pupil.id),
        pupil.display_attendance === false
          ? null
          : client.attendance(pupil.id, { from: schoolYearStart(today), to: today }),
      ]);

      const homework = hw.map(toHomework).sort((a, b) => a.due.localeCompare(b.due));
      const todo = homework.filter((h) => !h.done);
      const nextDay = next ? toDay(next.date, next.tt.lessons, next.tt.meta, homework, pupil.school_name) : null;
      const dets = detentions?.map((d) => toDetention(d, today)) ?? null;
      const relevantDets = dets?.filter((d) => d.upcoming || d.date >= weekAgo) ?? null;
      const beh = behaviour ? summarisePoints(behaviour.map(toPoint).filter((p) => p.date >= weekAgo), weekAgo, today) : null;
      const anns =
        announcements
          ?.map((a) => toAnnouncement(a, tz))
          .filter((a) => a.date >= weekAgo)
          .sort((a, b) => b.date.localeCompare(a.date)) ?? null;
      const att = attendance ? toAttendance(attendance.days, attendance.meta, schoolYearStart(today), today) : null;

      const json = {
        date: today,
        nextSchoolDay: nextDay,
        homeworkTodo: todo,
        detentions: relevantDets,
        behaviourLast7Days: beh,
        announcementsLast7Days: anns,
        attendanceThisYear: att,
      };

      const lines = [`${dayLabel(today)}`];
      if (nextDay) {
        const week = nextDay.lessons.find((l) => l.week != null)?.week;
        const first = nextDay.lessons[0];
        const last = nextDay.lessons[nextDay.lessons.length - 1];
        lines.push("", heading(s, `Next school day · ${dayLabel(nextDay.date)}${week ? ` · week ${week}` : ""}`));
        lines.push(
          nextDay.schoolDay
            ? `  ${s("cyan", `${first.start}–${last.end}`)}  ${lessonSummary(nextDay)}`
            : "  No lessons found in the next three weeks.",
        );
      }
      lines.push("", heading(s, `Homework to do (due by ${hwRange.to})`));
      lines.push(todo.length ? todo.map((h) => `  ${renderHomework(h, { style: s })}`).join("\n") : "  Nothing outstanding.");
      if (relevantDets) {
        lines.push("", heading(s, "Detentions"));
        lines.push(relevantDets.length ? indentLines(renderDetentions(relevantDets, s)) : "  None.");
      }
      if (beh) lines.push("", heading(s, "Behaviour (last 7 days)"), `  ${renderBehaviourLine(beh, s)}`);
      if (anns) {
        lines.push("", heading(s, "Announcements (last 7 days)"));
        lines.push(anns.length ? anns.map((a) => `  ${renderAnnouncement(a, { style: s, titleOnly: true })}`).join("\n") : "  None.");
      }
      if (att) lines.push("", heading(s, "Attendance (this school year)"), `  ${renderAttendanceLine(att, s)}`);
      return out(json, lines.join("\n"));
    }
  }
  throw new Error(`Unknown command "${command}".`);
}

const dayLabel = (date: string) =>
  `${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })} ${date}`;
const indentLines = (text: string) =>
  text
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");

main(process.argv.slice(2)).then(
  (text) => console.log(text),
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`classcharts: ${msg}`);
    process.exit(err instanceof ClassChartsAuthError ? 2 : 1);
  },
);
