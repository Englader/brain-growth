/**
 * Calendar helpers. Streaks, quests and leagues are defined on the device's
 * LOCAL calendar day, because that is what a child means by "today".
 */
export const DAY_MS = 86_400_000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar day key "YYYY-MM-DD". */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local month key "YYYY-MM" (log chunking and freeze grants). */
export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Parse "YYYY-MM-DD" to local-noon timestamp (noon avoids DST edge cases). */
export function dayStart(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return dayKey(new Date(y, m - 1, d + n, 12).getTime());
}

/** Whole calendar days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayStart(b) - dayStart(a)) / DAY_MS);
}

/** ISO-8601 week key "YYYY-Www" (weeks start Monday, as in MK and most of Europe). */
export function weekKey(ts: number): string {
  const d = new Date(ts);
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}

/** Monday..Sunday day keys for the week containing ts. */
export function weekDays(ts: number): string[] {
  const d = new Date(ts);
  const dow = d.getDay() || 7;
  const monday = dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow + 1, 12).getTime());
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function hourOf(ts: number): number {
  return new Date(ts).getHours();
}
