// Turn raw ClassCharts records into small, agent-friendly shapes and text.

import { dayName, longDate, shortDate } from "./dates.ts";
import type { RawHomework, RawLesson } from "./types.ts";

export interface Lesson {
  date: string;
  start: string; // HH:MM
  end: string;
  subject: string;
  room: string | null;
  teacher: string | null;
  class: string | null;
  week: number | null; // week of a multi-week timetable, when the school encodes it
  period: string | null;
  note: string | null;
}

export interface Homework {
  id: number;
  subject: string;
  title: string;
  teacher: string | null;
  class: string | null;
  issued: string;
  due: string;
  done: boolean;
  state: string | null; // school-set state (late, completed…), often null
  minutes: number | null;
  description: string;
  links: string[];
  attachments: { name: string; url: string | null }[]; // url is a short-lived signed link
}

export interface Day {
  date: string;
  day: string;
  schoolDay: boolean; // false = holiday/INSET/weekend (no lessons returned)
  lessons: Lesson[];
  homeworkDue: Homework[];
}

// The named entities schools' rich-text editors actually produce. &amp; is decoded last.
const ENTITIES: Record<string, string> = {
  nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'",
  pound: "£", euro: "€", rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", bull: "\u2022", copy: "©",
};

const codePoint = (n: number) => (Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "");

export function stripHtml(html = ""): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\s*(br|\/p|\/li|\/div)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&amp;/gi, "&")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Trimmed string, or null when empty/missing. */
export function blank(value: unknown): string | null {
  const s = value == null ? "" : String(value).trim();
  return s || null;
}
const hhmm = (iso: string) => iso.slice(11, 16);

// Some schools' MIS exports period names like "wednesday - 08:30:00 - 08:50:00 - 2"
// where the trailing number is the timetable week. Others use "Period 1" etc.
const ENCODED_PERIOD = /^[a-z]+day\s*-\s*\d{2}:\d{2}(?::\d{2})?\s*-\s*\d{2}:\d{2}(?::\d{2})?\s*-\s*(\d+)$/i;

export function parsePeriod(name: string): { week: number | null; period: string | null } {
  const m = ENCODED_PERIOD.exec(name.trim());
  if (m) return { week: Number(m[1]), period: null };
  return { week: null, period: blank(name) };
}

/** Drop a leading "<SCHOOL NAME>: " from room names. */
export function cleanRoom(room: string, schoolName?: string): string | null {
  const r = room.trim();
  if (schoolName) {
    const prefix = `${schoolName.trim().toLowerCase()}:`;
    if (r.toLowerCase().startsWith(prefix)) return blank(r.slice(prefix.length));
  }
  return blank(r);
}

export function toLesson(raw: RawLesson, schoolName?: string): Lesson {
  const { week, period } = parsePeriod(raw.period_name ?? "");
  return {
    date: raw.date,
    start: hhmm(raw.start_time),
    end: hhmm(raw.end_time),
    subject: raw.subject_name,
    room: cleanRoom(raw.room_name ?? "", schoolName),
    teacher: blank(raw.teacher_name),
    class: blank(raw.lesson_name),
    week,
    period,
    note: blank(stripHtml(raw.note)),
  };
}

export function toHomework(raw: RawHomework): Homework {
  const minutes = Number(raw.completion_time_value);
  const unit = raw.completion_time_unit?.toLowerCase();
  return {
    id: raw.id,
    subject: raw.subject,
    title: raw.title.trim(),
    teacher: blank(raw.teacher),
    class: blank(raw.lesson),
    issued: raw.issue_date,
    due: raw.due_date,
    done: raw.status?.ticked === "yes" || raw.status?.state === "completed",
    state: raw.status?.state ?? null,
    minutes: Number.isFinite(minutes) && minutes > 0 ? (unit === "hours" ? minutes * 60 : minutes) : null,
    description: stripHtml(raw.description),
    links: (raw.validated_links ?? []).map((l) => l.link).filter(Boolean),
    attachments: (raw.validated_attachments ?? []).map((a) => ({ name: a.filename, url: a.file ?? null })),
  };
}

export function toDay(
  date: string,
  lessons: RawLesson[],
  homeworks: Homework[],
  schoolName?: string,
): Day {
  return {
    date,
    day: dayName(date),
    schoolDay: lessons.length > 0,
    lessons: lessons.map((l) => toLesson(l, schoolName)).sort((a, b) => a.start.localeCompare(b.start)),
    homeworkDue: homeworks.filter((h) => h.due === date),
  };
}

// ---- text rendering --------------------------------------------------------

/** Optional styling (colour on a terminal). Defaults to plain text for agents and pipes. */
export type Style = (format: "bold" | "dim" | "green" | "yellow" | "cyan" | "red" | "magenta", text: string) => string;
export const plain: Style = (_f, t) => t;

/** Section heading: bold magenta on a terminal, plain otherwise. */
export const heading = (s: Style, text: string) => s("bold", s("magenta", text));

export interface RenderOptions {
  full?: boolean; // full homework descriptions
  style?: Style;
}

export function renderHomework(h: Homework, opts: RenderOptions = {}): string {
  const s = opts.style ?? plain;
  const bits = [h.done ? "done" : "todo", h.state && h.state !== "completed" ? h.state : null]
    .filter(Boolean)
    .join(", ");
  const meta = [h.minutes ? `${h.minutes} min` : null, h.teacher].filter(Boolean).join(", ");
  const tag = s(h.done ? "green" : "yellow", `[${bits}]`);
  const lines = [`- ${tag} due ${shortDate(h.due)} · ${s("bold", `${h.subject}: ${h.title}`)}${meta ? s("dim", ` (${meta})`) : ""}`];
  if (h.description) {
    lines.push(opts.full ? indent(h.description, "    ") : s("dim", `    ${truncate(h.description, 160)}`));
  }
  if (opts.full) {
    for (const l of h.links) lines.push(`    link: ${l}`);
    for (const a of h.attachments) lines.push(`    attachment: ${a.name}`);
  }
  return lines.join("\n");
}

export function renderHomeworkList(list: Homework[], opts: RenderOptions = {}): string {
  if (list.length === 0) return "No homework in this range.";
  const todo = list.filter((h) => !h.done).length;
  return [`${list.length} homework (${todo} todo):`, ...list.map((h) => renderHomework(h, opts))].join("\n");
}

export function renderLesson(l: Lesson, s: Style = plain): string {
  const where = [l.room, l.teacher].filter(Boolean).join(", ");
  return `  ${s("cyan", `${l.start}–${l.end}`)}  ${l.subject}${where ? s("dim", ` (${where})`) : ""}${l.note ? ` · note: ${l.note}` : ""}`;
}

export function renderDay(d: Day, opts: RenderOptions = {}): string {
  const week = d.lessons.find((l) => l.week != null)?.week;
  const s = opts.style ?? plain;
  const lines = [heading(s, `${longDate(d.date)}${week ? ` · week ${week}` : ""}`)];
  if (!d.schoolDay) lines.push("  No lessons (weekend, holiday or INSET day).");
  else {
    const first = d.lessons[0];
    const last = d.lessons[d.lessons.length - 1];
    lines.push(`  ${first.start}–${last.end}, ${d.lessons.length} lessons`);
    lines.push(...d.lessons.map((l) => renderLesson(l, s)));
  }
  if (d.homeworkDue.length) {
    lines.push("  Homework due:");
    lines.push(...d.homeworkDue.map((h) => indent(renderHomework(h, opts), "  ")));
  }
  return lines.join("\n");
}

export function indent(s: string, pad: string): string {
  return s
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}
