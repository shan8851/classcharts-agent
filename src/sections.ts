// Announcements, behaviour, detentions and attendance: normalise and render.

import { localDate, shortDate } from "./dates.ts";
import { blank, heading, indent, plain, type RenderOptions, type Style, stripHtml, truncate } from "./format.ts";
import type {
  AttendanceMeta,
  RawActivityPoint,
  RawAnnouncement,
  RawAttendanceSession,
  RawDetention,
} from "./types.ts";


// ---- announcements ----------------------------------------------------------

export interface Announcement {
  id: number;
  date: string;
  title: string;
  from: string | null;
  text: string;
  pinned: boolean;
  consentRequired: boolean;
  consentGiven: boolean | null;
  attachments: { name: string; url: string | null }[];
}

export function toAnnouncement(raw: RawAnnouncement, timeZone?: string): Announcement {
  const given = raw.consent?.consent_given;
  return {
    id: raw.id,
    date: localDate(raw.timestamp, timeZone),
    title: raw.title.trim(),
    from: blank(raw.teacher_name),
    text: stripHtml(raw.description ?? ""),
    pinned: raw.sticky === "yes" || raw.priority_pinned === "yes",
    consentRequired: raw.requires_consent === "yes",
    consentGiven: given === "yes" ? true : given === "no" ? false : null,
    attachments: (raw.attachments ?? []).map((a) => ({ name: a.filename, url: a.url ?? null })),
  };
}

export function renderAnnouncement(a: Announcement, opts: RenderOptions & { titleOnly?: boolean } = {}): string {
  const s = opts.style ?? plain;
  const flags = [
    a.pinned ? s("cyan", "[pinned]") : null,
    a.consentRequired && a.consentGiven === null ? s("yellow", "[consent needed]") : null,
    a.attachments.length ? s("dim", `[${a.attachments.length} attachment${a.attachments.length > 1 ? "s" : ""}]`) : null,
  ].filter(Boolean);
  const lines = [`- ${shortDate(a.date)} · ${s("bold", a.title)}${a.from ? s("dim", ` (${a.from})`) : ""}${flags.length ? ` ${flags.join(" ")}` : ""}`];
  if (!opts.titleOnly && a.text) lines.push(opts.full ? indent(a.text, "    ") : s("dim", `    ${truncate(a.text, 200)}`));
  if (opts.full) for (const f of a.attachments) lines.push(`    attachment: ${f.name}`);
  return lines.join("\n");
}

// ---- behaviour --------------------------------------------------------------

export interface Point {
  date: string;
  time: string;
  polarity: "positive" | "negative" | "neutral";
  reason: string;
  score: number;
  lesson: string | null;
  teacher: string | null;
  note: string | null;
}

export function toPoint(raw: RawActivityPoint): Point {
  return {
    date: raw.timestamp.slice(0, 10),
    time: raw.timestamp.slice(11, 16),
    polarity: raw.polarity === "positive" ? "positive" : raw.polarity === "negative" ? "negative" : "neutral",
    reason: raw.reason,
    score: Number(raw.score) || 0,
    lesson: blank(raw.lesson_name),
    teacher: blank(raw.teacher_name),
    note: blank(stripHtml(raw.note ?? "")),
  };
}

export interface BehaviourSummary {
  from: string;
  to: string;
  positive: { count: number; reasons: Record<string, number> };
  negative: { count: number; reasons: Record<string, number> };
}

/** Count points by reason. Built from the points themselves so totals always match the list. */
export function summarisePoints(points: Point[], from: string, to: string): BehaviourSummary {
  const tally = (pol: Point["polarity"]) => {
    const reasons: Record<string, number> = {};
    for (const p of points) if (p.polarity === pol) reasons[p.reason] = (reasons[p.reason] ?? 0) + 1;
    return { count: Object.values(reasons).reduce((a, b) => a + b, 0), reasons };
  };
  return { from, to, positive: tally("positive"), negative: tally("negative") };
}

const byCount = (r: Record<string, number>) =>
  Object.entries(r)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");

export function renderBehaviourLine(b: BehaviourSummary, s: Style = plain): string {
  if (b.positive.count === 0 && b.negative.count === 0) return "No behaviour points.";
  const parts = [s("green", `${b.positive.count} positive`) + (b.positive.count ? s("dim", ` (${byCount(b.positive.reasons)})`) : "")];
  parts.push(
    b.negative.count ? s("red", `${b.negative.count} negative`) + s("dim", ` (${byCount(b.negative.reasons)})`) : "0 negative",
  );
  return parts.join(", ");
}

export function renderPoint(p: Point, s: Style = plain): string {
  const sign = p.polarity === "positive" ? s("green", `+${p.score}`) : p.polarity === "negative" ? s("red", `${-Math.abs(p.score)}`) : "·";
  const where = [p.lesson, p.teacher].filter(Boolean).join(", ");
  return `- ${shortDate(p.date)} ${p.time}  ${sign} ${p.reason}${where ? s("dim", ` (${where})`) : ""}${p.note ? ` · ${p.note}` : ""}`;
}

export function renderBehaviour(b: BehaviourSummary, points: Point[], opts: RenderOptions = {}): string {
  const s = opts.style ?? plain;
  const lines = [heading(s, `Behaviour ${b.from} → ${b.to}`), `  ${renderBehaviourLine(b, s)}`];
  if (points.length) lines.push(...points.map((p) => `  ${renderPoint(p, s)}`));
  return lines.join("\n");
}

// ---- detentions -------------------------------------------------------------

export interface Detention {
  date: string;
  time: string | null;
  minutes: number | null;
  location: string | null;
  type: string | null;
  reason: string | null;
  subject: string | null;
  teacher: string | null;
  status: string; // yes (attended), no, pending, upscaled
  upcoming: boolean;
}

export function toDetention(raw: RawDetention, today: string, timeZone?: string): Detention {
  // A full timestamp may be UTC midnight for a BST date, so read it in the school's timezone.
  const rawDate = String(raw.date ?? "");
  const date = rawDate.length > 10 ? localDate(rawDate, timeZone) : rawDate;
  const t = raw.teacher;
  const teacher = t ? [t.title, t.first_name?.[0], t.last_name].filter(Boolean).join(" ") : "";
  return {
    date,
    time: raw.time ? String(raw.time).slice(0, 5) : null,
    minutes: raw.length ? Number(raw.length) : null,
    location: blank(raw.location),
    type: blank(raw.detention_type?.name),
    reason: blank(raw.lesson_pupil_behaviour?.reason),
    subject: blank(raw.lesson?.subject?.name),
    teacher: blank(teacher),
    status: raw.attended ?? "pending",
    upcoming: date >= today && raw.attended !== "yes",
  };
}

export function renderDetention(d: Detention, s: Style = plain): string {
  const when = [d.time, d.minutes ? `${d.minutes} min` : null, d.location].filter(Boolean).join(", ");
  const why = [d.reason, d.subject, d.teacher].filter(Boolean).join(", ");
  const status = d.upcoming ? s("red", "[upcoming]") : s("dim", `[${d.status === "yes" ? "attended" : d.status}]`);
  return `- ${status} ${shortDate(d.date)}${when ? ` ${when}` : ""} · ${d.type ?? "Detention"}${why ? s("dim", ` (${why})`) : ""}`;
}

export function renderDetentions(list: Detention[], s: Style = plain): string {
  if (list.length === 0) return "No detentions.";
  // Upcoming first, soonest first; then past ones, most recent first.
  const sorted = [...list].sort(
    (a, b) =>
      Number(b.upcoming) - Number(a.upcoming) ||
      (a.upcoming ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)),
  );
  return sorted.map((d) => renderDetention(d, s)).join("\n");
}

// ---- attendance -------------------------------------------------------------

export interface AttendanceSummary {
  from: string;
  to: string;
  percentage: number | null;
  sinceAugust: number | null;
  /** Sessions that weren't plain "present" (absences, lates…). */
  issues: { date: string; session: string; status: string; code: string; lateMinutes: number }[];
}

const pct = (v: number | string | null | undefined) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const FINE = new Set(["present", "", "no_mark", "not_required", "ignore"]);

export function toAttendance(
  days: Record<string, Record<string, RawAttendanceSession>>,
  meta: AttendanceMeta | undefined,
  from: string,
  to: string,
): AttendanceSummary {
  const issues: AttendanceSummary["issues"] = [];
  for (const [date, sessions] of Object.entries(days ?? {})) {
    for (const [session, v] of Object.entries(sessions ?? {})) {
      const status = String(v?.status ?? "").toLowerCase();
      if (!FINE.has(status)) {
        issues.push({ date, session, status, code: v.code, lateMinutes: Number(v.late_minutes) || 0 });
      }
    }
  }
  issues.sort((a, b) => a.date.localeCompare(b.date));
  return { from, to, percentage: pct(meta?.percentage), sinceAugust: pct(meta?.percentage_singe_august), issues };
}

export function renderAttendanceLine(a: AttendanceSummary, s: Style = plain): string {
  const p = a.percentage == null ? "?" : `${a.percentage}%`;
  const since = a.sinceAugust == null ? "" : s("dim", ` (since August ${a.sinceAugust}%)`);
  const issues = a.issues.length ? s("yellow", `, ${a.issues.length} session${a.issues.length > 1 ? "s" : ""} not present`) : ", no absences or lates";
  return `${p}${since}${issues}`;
}

export function renderAttendance(a: AttendanceSummary, opts: RenderOptions = {}): string {
  const s = opts.style ?? plain;
  const lines = [heading(s, `Attendance ${a.from} → ${a.to}`), `  ${renderAttendanceLine(a, s)}`];
  for (const i of a.issues) {
    lines.push(`  - ${shortDate(i.date)} ${i.session}: ${i.status}${i.lateMinutes ? ` (${i.lateMinutes} min late)` : ""}`);
  }
  return lines.join("\n");
}
