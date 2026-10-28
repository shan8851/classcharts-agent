#!/usr/bin/env node
// classcharts: read-only ClassCharts CLI for agents (parent accounts).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, styleText } from "node:util";
import { ClassChartsAuthError, ClassChartsClient } from "./client.ts";
import { addDays, nextSchoolDay, resolveDate, schoolWeek, todayIn } from "./dates.ts";
import { type RenderOptions, renderDay, renderHomeworkList, toDay, toHomework } from "./format.ts";
import { fileSessionStore } from "./session.ts";
import type { RawPupil } from "./types.ts";

const HELP = `classcharts: read-only ClassCharts for a parent account

Usage: classcharts <command> [date] [options]

Commands:
  day [DATE]        Lessons + homework due that day (default: today)
  week [DATE]       Mon–Fri lessons + homework due that week (default: this week)
  homework          Homework by due date (default: 7 days ago → 21 days ahead)
  timetable [DATE]  Lessons only for one day
  pupils            Children linked to the account

DATE: YYYY-MM-DD, today, tomorrow, yesterday, next, or a weekday (mon, friday…)
      day/timetable next = next day with lessons (skips weekends and holidays)
      week next          = next week

Options:
  --pupil <id|name> Which child (default: CLASSCHARTS_PUPIL, else the first)
  --from <DATE>     homework: start of due-date range
  --to <DATE>       homework: end of due-date range
  --todo            homework: only items not marked done
  --full            Full homework descriptions, links and attachments
  --json            JSON output instead of text
                    (text is coloured on a terminal, plain when piped; NO_COLOR respected)
  -h, --help

Env: CLASSCHARTS_EMAIL, CLASSCHARTS_PASSWORD, CLASSCHARTS_PUPIL (optional).
A .env file next to this repo's package.json is loaded automatically.
The login session is cached in ~/.cache/classcharts-agent/ (override: CLASSCHARTS_SESSION_FILE),
because ClassCharts blocks repeated logins for a few minutes.`;

const COMMANDS = ["day", "week", "homework", "timetable", "pupils"];
const isNext = (s?: string) => s === "next" || s === "next-school-day";

function loadEnv() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const file = process.env.CLASSCHARTS_ENV_FILE ?? join(root, ".env");
  if (existsSync(file) && !(process.env.CLASSCHARTS_EMAIL && process.env.CLASSCHARTS_PASSWORD)) {
    process.loadEnvFile(file);
  }
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
    },
  });
  const [command, dateArg] = positionals;
  // styleText only colours when stdout is a colour-capable TTY, so agents get plain text.
  const render: RenderOptions = { full: values.full, style: (f, t) => styleText(f, t) };
  if (values.help || !command || command === "help") return HELP;
  // Fail on typos before touching the network (logins are rate-limited).
  if (!COMMANDS.includes(command)) throw new Error(`Unknown command "${command}".\n\n${HELP}`);
  for (const d of [dateArg, values.from, values.to]) if (d) resolveDate(d, todayIn("Europe/London"));

  loadEnv();
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
      timetable: p.display_timetable,
    }));
    return values.json
      ? JSON.stringify(list, null, 2)
      : list.map((p) => `${p.id}  ${p.name} · ${p.school} · homework todo ${p.homeworkTodo}, late ${p.homeworkLate}`).join("\n");
  }

  const pupil = pickPupil(pupils, values.pupil ?? process.env.CLASSCHARTS_PUPIL);
  const tz = pupil.timezone || "Europe/London";
  const today = todayIn(tz);
  const who = { id: pupil.id, name: pupil.name, school: pupil.school_name };
  const out = (json: unknown, text: string) =>
    values.json ? JSON.stringify({ pupil: who, ...(json as object) }, null, 2) : `${pupil.first_name} · ${text}`;

  switch (command) {
    case "homework": {
      const from = resolveDate(values.from ?? addDays(today, -7), today);
      const to = resolveDate(values.to ?? addDays(today, 21), today);
      let list = (await client.homeworks(pupil.id, { from, to })).map(toHomework);
      if (values.todo) list = list.filter((h) => !h.done);
      list.sort((a, b) => a.due.localeCompare(b.due));
      return out({ from, to, homework: list }, `homework due ${from} → ${to}\n${renderHomeworkList(list, render)}`);
    }

    case "day":
    case "timetable": {
      let date = resolveDate(dateArg, today);
      let tt = await client.timetable(pupil.id, date);
      let skipped = 0;
      if (isNext(dateArg)) {
        // Walk past holidays/INSET days: up to 3 school weeks (covers Christmas).
        while (tt.lessons.length === 0 && skipped < 15) {
          date = nextSchoolDay(date);
          tt = await client.timetable(pupil.id, date);
          skipped++;
        }
      }
      const hw = command === "day" ? await client.homeworks(pupil.id, { from: date, to: date }) : [];
      const day = toDay(date, tt.lessons, tt.meta, hw.map(toHomework), pupil.school_name);
      const note = skipped ? `\n  (skipped ${skipped} weekday${skipped > 1 ? "s" : ""} with no lessons)` : "";
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
      return out({ from: dates[0], to: dates[4], days }, `week of ${dates[0]}\n\n${days.map((d) => renderDay(d, render)).join("\n\n")}`);
    }

  }
  throw new Error(`Unknown command "${command}".`);
}

main(process.argv.slice(2)).then(
  (text) => console.log(text),
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`classcharts: ${msg}`);
    process.exit(err instanceof ClassChartsAuthError ? 2 : 1);
  },
);
