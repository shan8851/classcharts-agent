// Dates are plain "YYYY-MM-DD" strings in the school's timezone.

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function dayName(date: string): string {
  const n = DAYS[weekday(date)];
  return n[0].toUpperCase() + n.slice(1);
}

export const isWeekend = (date: string) => weekday(date) === 0 || weekday(date) === 6;

export function nextSchoolDay(from: string): string {
  let d = addDays(from, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/** Monday–Friday of the week containing `date` (Sat/Sun roll forward to next week). */
export function schoolWeek(date: string): string[] {
  const wd = weekday(date);
  const monday = addDays(date, wd === 0 ? 1 : wd === 6 ? 2 : 1 - wd);
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

/**
 * Accepts: today, tomorrow, yesterday, next (next school day),
 * a weekday name (next occurrence, today included), or YYYY-MM-DD.
 */
export function resolveDate(input: string | undefined, today: string): string {
  const s = (input ?? "today").trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s === "today") return today;
  if (s === "tomorrow") return addDays(today, 1);
  if (s === "yesterday") return addDays(today, -1);
  if (s === "next" || s === "next-school-day") return nextSchoolDay(today);
  const idx = DAYS.findIndex((d) => d === s || d.slice(0, 3) === s);
  if (idx >= 0) return addDays(today, (idx - weekday(today) + 7) % 7);
  throw new Error(`Can't read date "${input}". Use YYYY-MM-DD, today, tomorrow, next, or a weekday.`);
}
