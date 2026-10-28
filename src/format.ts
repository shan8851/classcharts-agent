// Turn raw ClassCharts records into small, agent-friendly shapes and text.

import { dayName } from "./dates.ts";
import type { RawHomework, RawLesson, TimetableMeta } from "./types.ts";

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

export function stripHtml(html = ""): string {
  return html
    .replace(/<\s*(br|\/p|\/li|\/div)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
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
  meta: TimetableMeta | undefined,
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
export type Style = (format: "bold" | "dim" | "green" | "yellow" | "cyan", text: string) => string;
const plain: Style = (_f, t) => t;

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
  const lines = [`- ${tag} due ${dayName(h.due).slice(0, 3)} ${h.due} · ${s("bold", `${h.subject}: ${h.title}`)}${meta ? s("dim", ` (${meta})`) : ""}`];
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
  const sorted = [...list].sort((a, b) => a.due.localeCompare(b.due));
  return [`${list.length} homework (${todo} todo):`, ...sorted.map((h) => renderHomework(h, opts))].join("\n");
}

export function renderLesson(l: Lesson, s: Style = plain): string {
  const where = [l.room, l.teacher].filter(Boolean).join(", ");
  return `  ${s("cyan", `${l.start}–${l.end}`)}  ${l.subject}${where ? s("dim", ` (${where})`) : ""}${l.note ? ` · note: ${l.note}` : ""}`;
}

export function renderDay(d: Day, opts: RenderOptions = {}): string {
  const week = d.lessons.find((l) => l.week != null)?.week;
  const head = `${d.day} ${d.date}${week ? ` · week ${week}` : ""}`;
  const s = opts.style ?? plain;
  const lines = [s("bold", head)];
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

function indent(s: string, pad: string): string {
  return s
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}
