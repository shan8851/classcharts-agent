#!/usr/bin/env node
// classcharts: read-only ClassCharts CLI for agents (parent accounts).

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, styleText } from "node:util";
import { ClassChartsAuthError, ClassChartsClient } from "./client.ts";
import { addDays, resolveDate, schoolWeek, schoolYearStart, todayIn } from "./dates.ts";
import { digest, nextDayWithLessons } from "./digest.ts";
import {
  heading,
  plain,
  type RenderOptions,
  renderDay,
  renderHomeworkList,
  type Style,
  toDay,
  toHomework,
} from "./format.ts";
import {
  renderAnnouncement,
  renderAttendance,
  renderBehaviour,
  renderDetentions,
  summarisePoints,
  toAnnouncement,
  toAttendance,
  toDetention,
  toPoint,
} from "./sections.ts";
import { fileSessionStore } from "./session.ts";
import { configEnvFile, setup } from "./setup.ts";
import type { RawPupil } from "./types.ts";

export const HELP = `classcharts: read-only ClassCharts for a parent account

Usage: classcharts <command> [date] [options]

Commands:
  digest            Everything worth knowing: next school day, homework to do
                    (including overdue), detentions, behaviour, announcements, attendance
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
  --pupil <id|name> Which child (default: CLASSCHARTS_PUPIL; required if several are linked)
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

const DATED = new Set(["day", "week", "timetable"]);
const RANGED = new Set(["homework", "announcements", "behaviour", "attendance"]);
const COMMANDS = new Set([...DATED, ...RANGED, "digest", "detentions", "pupils", "setup", "skill"]);
const isNext = (s?: string) => s === "next" || s === "next-school-day";

/** Package root: works from src/ (clone) and dist/ (npm). */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLONE_ENV = join(ROOT, ".env");

/** Where a saved login is looked for, in order (after real environment variables). */
const defaultEnvFiles = () => [process.env.CLASSCHARTS_ENV_FILE, CLONE_ENV, configEnvFile()];

function loadEnv(files: (string | undefined)[]) {
  if (process.env.CLASSCHARTS_EMAIL && process.env.CLASSCHARTS_PASSWORD) return;
  const file = files.find((f) => !!f && existsSync(f));
  if (file) process.loadEnvFile(file);
}

export function pickPupil(pupils: RawPupil[], wanted?: string): RawPupil {
  if (pupils.length === 0) throw new Error("No children are linked to this ClassCharts account.");
  const linked = pupils.map((p) => `${p.name} (${p.id})`).join(", ");
  if (!wanted?.trim()) {
    // With several children, never guess: an agent could report the wrong child's day.
    if (pupils.length > 1) {
      throw new Error(`More than one child is linked; choose one with --pupil or CLASSCHARTS_PUPIL. Linked: ${linked}`);
    }
    return pupils[0];
  }
  const w = wanted.trim().toLowerCase();
  const byId = pupils.find((p) => String(p.id) === w);
  if (byId) return byId;
  const matches = pupils.filter((p) => p.first_name?.toLowerCase() === w || p.name?.toLowerCase() === w);
  if (matches.length > 1) throw new Error(`More than one pupil matches "${wanted}"; use the id. Linked: ${linked}`);
  if (!matches.length) throw new Error(`No pupil matching "${wanted}". Linked: ${linked}`);
  return matches[0];
}

/** Colour only on a colour-capable terminal (hasColors respects NO_COLOR and FORCE_COLOR). */
function terminalStyle(): Style {
  const colour = !!process.stdout.isTTY && process.stdout.hasColors?.() === true;
  return colour ? (f, t) => styleText(f, t, { validateStream: false }) : plain;
}

export interface MainOptions {
  style?: Style;
  /** Login files to try (tests pass [] so a real login is never read). */
  envFiles?: (string | undefined)[];
}

/** Runs a command and returns its output. Throws on errors; see `exitCode`. */
export async function main(argv: string[], opts: MainOptions = {}): Promise<string> {
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
  const s = opts.style ?? terminalStyle();
  const render: RenderOptions = { full: values.full, style: s };

  if (values.version) return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  if (values.help || !command || command === "help") return HELP;
  // Fail on typos before touching the network (logins are rate-limited).
  if (!COMMANDS.has(command)) throw new Error(`Unknown command "${command}".\n\n${HELP}`);
  const check = (d?: string) => d && resolveDate(d, todayIn("Europe/London"));
  if (DATED.has(command)) check(dateArg);
  if (RANGED.has(command)) [values.from, values.to].forEach(check);

  if (command === "skill") return readFileSync(join(ROOT, "SKILL.md"), "utf8").trimEnd();
  if (command === "setup") return setup(CLONE_ENV);

  loadEnv(opts.envFiles ?? defaultEnvFiles());
  const email = process.env.CLASSCHARTS_EMAIL;
  const password = process.env.CLASSCHARTS_PASSWORD;
  if (!email || !password) {
    throw new ClassChartsAuthError(
      "No ClassCharts login found. A person needs to run `classcharts setup` once " +
        "(or set CLASSCHARTS_EMAIL and CLASSCHARTS_PASSWORD).",
    );
  }
  const client = new ClassChartsClient({ email, password, session: fileSessionStore(email) });
  const pupils = await client.pupils();

  if (command === "pupils") return pupilsCommand(pupils, values.json, s);

  const pupil = pickPupil(pupils, values.pupil ?? process.env.CLASSCHARTS_PUPIL);
  const tz = pupil.timezone || "Europe/London";
  const today = todayIn(tz);
  const who = { id: pupil.id, name: pupil.name, school: pupil.school_name };
  const out = (json: object, text: string) =>
    values.json ? JSON.stringify({ pupil: who, ...json }, null, 2) : `${s("bold", pupil.first_name)} · ${text}`;
  const from = (fallback: string) => resolveDate(values.from ?? fallback, today);
  const to = (fallback: string) => resolveDate(values.to ?? fallback, today);
  /** The school switched this section off in ClassCharts. */
  const hidden = (section: string) =>
    out({ hiddenBySchool: section }, `${pupil.first_name}'s school doesn't show ${section} in ClassCharts.`);

  switch (command) {
    case "digest": {
      const d = await digest(client, pupil, today, tz, s);
      return out(d.json, d.text);
    }

    case "homework": {
      if (pupil.display_homework === false) return hidden("homework");
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
      let lessons = (await client.timetable(pupil.id, date)).lessons;
      let skipped = 0;
      if (isNext(dateArg) && lessons.length === 0) {
        const found = await nextDayWithLessons(client, pupil.id, date);
        if (!found) {
          return out(
            { date: null, schoolDay: false, lessons: [], homeworkDue: [] },
            "No lessons found in the next three weeks.",
          );
        }
        ({ date, lessons } = found);
        skipped = found.skipped + 1;
      }
      const hw = command === "day" ? await client.homeworks(pupil.id, { from: date, to: date }) : [];
      const day = toDay(date, lessons, hw.map(toHomework), pupil.school_name);
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
      const days = dates.map((d, i) => toDay(d, tts[i].lessons, homework, pupil.school_name));
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
      const points = (await client.activity(pupil.id, range))
        .map(toPoint)
        .filter((p) => p.date >= range.from && p.date <= range.to);
      const b = summarisePoints(points, range.from, range.to);
      return out({ ...b, points }, renderBehaviour(b, points, render));
    }

    case "detentions": {
      if (pupil.display_detentions === false) return hidden("detentions");
      const list = (await client.detentions(pupil.id)).map((d) => toDetention(d, today, tz));
      return out({ detentions: list }, `${heading(s, "Detentions")}\n${renderDetentions(list, s)}`);
    }

    case "attendance": {
      if (pupil.display_attendance === false) return hidden("attendance");
      const range = { from: from(schoolYearStart(today)), to: to(today) };
      const { days, meta } = await client.attendance(pupil.id, range);
      const a = toAttendance(days, meta, range.from, range.to);
      return out(a, renderAttendance(a, render));
    }
  }
  throw new Error(`Unknown command "${command}".`);
}

function pupilsCommand(pupils: RawPupil[], json: boolean | undefined, s: Style): string {
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
  if (json) return JSON.stringify(list, null, 2);
  return list
    .map((p) => {
      const on = Object.entries(p.sections)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(", ");
      return `${s("bold", p.name)} ${s("dim", `(${p.id})`)} · ${p.school}\n  homework todo ${p.homeworkTodo}, late ${p.homeworkLate}\n  ${s("dim", `sections: ${on}`)}`;
    })
    .join("\n");
}

/** 2 = login problem (bad credentials, rate limit, no login set up); 1 = anything else. */
export const exitCode = (err: unknown) => (err instanceof ClassChartsAuthError ? 2 : 1);

/** True when this file is the program being run (not imported by tests). Follows npm's bin symlink. */
function isEntryPoint(): boolean {
  try {
    return !!process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).then(
    (text) => console.log(text),
    (err: unknown) => {
      console.error(`classcharts: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(exitCode(err));
    },
  );
}
