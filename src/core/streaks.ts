/**
 * Streaks, designed around three rules:
 *  1. The daily minimum takes under 60 seconds (3 items — the "quick spark").
 *  2. Two freezes per calendar month are applied AUTOMATICALLY and silently
 *     to bridge missed days. No purchase, no button, no guilt screen.
 *  3. Streak state is derived from a set of days, so merging two devices is a
 *     set union and can never shorten a streak.
 *
 * Frozen days bridge the streak but do not add to its length.
 */
import { addDays, daysBetween, monthKey, dayStart } from './time';

export const FREEZES_PER_MONTH = 2;
export const MIN_ITEMS_FOR_DAY = 3;
export const ESTABLISH_DAYS = 7;

export interface StreakState {
  activeDays: string[];
  freezeDays: string[];
  longest: number;
}

export const emptyStreak = (): StreakState => ({ activeDays: [], freezeDays: [], longest: 0 });

const sortedUnique = (xs: string[]): string[] => [...new Set(xs)].sort();

export function freezesUsedIn(s: StreakState, month: string): number {
  return s.freezeDays.filter((d) => d.startsWith(month)).length;
}

export function freezesLeft(s: StreakState, today: string): number {
  return Math.max(0, FREEZES_PER_MONTH - freezesUsedIn(s, today.slice(0, 7)));
}

/** Walk back from `today` over active/frozen days; frozen days bridge but do not count. */
export function currentStreak(s: StreakState, today: string): number {
  const active = new Set(s.activeDays);
  const frozen = new Set(s.freezeDays);
  let day = active.has(today) ? today : addDays(today, -1);
  let n = 0;
  for (let guard = 0; guard < 5000; guard++) {
    if (active.has(day)) n++;
    else if (!frozen.has(day)) break;
    day = addDays(day, -1);
  }
  return n;
}

/**
 * Bridge the gap between the last covered day and `today` with freezes, if
 * the allowance of each gap day's month covers it. Returns the days frozen.
 * Idempotent; call on app open and on day completion.
 */
export function applyFreezes(s: StreakState, today: string): { state: StreakState; frozen: string[] } {
  const covered = sortedUnique([...s.activeDays, ...s.freezeDays]).filter((d) => d < today);
  const last = covered[covered.length - 1];
  if (!last || !s.activeDays.length) return { state: s, frozen: [] };
  const gap = daysBetween(last, today) - 1;
  if (gap <= 0) return { state: s, frozen: [] };
  const gapDays = Array.from({ length: gap }, (_, i) => addDays(last, i + 1));
  const need = new Map<string, number>();
  for (const d of gapDays) need.set(d.slice(0, 7), (need.get(d.slice(0, 7)) ?? 0) + 1);
  for (const [m, n] of need) if (n > FREEZES_PER_MONTH - freezesUsedIn(s, m)) return { state: s, frozen: [] };
  return { state: { ...s, freezeDays: sortedUnique([...s.freezeDays, ...gapDays]) }, frozen: gapDays };
}

/** Mark `today` active (after the daily minimum). */
export function recordActiveDay(s: StreakState, today: string): StreakState {
  const bridged = applyFreezes(s, today).state;
  const next = { ...bridged, activeDays: sortedUnique([...bridged.activeDays, today]) };
  return { ...next, longest: Math.max(next.longest, currentStreak(next, today)) };
}

export function mergeStreaks(a: StreakState, b: StreakState): StreakState {
  return {
    activeDays: sortedUnique([...a.activeDays, ...b.activeDays]),
    freezeDays: sortedUnique([...a.freezeDays, ...b.freezeDays]),
    longest: Math.max(a.longest, b.longest),
  };
}

export type DayMark = 'active' | 'frozen' | 'missed' | 'today' | 'future';

export interface StreakView {
  current: number;
  longest: number;
  doneToday: boolean;
  freezesLeft: number;
  /** First-week framing: show a 7-stone path instead of a number. */
  establishing: boolean;
  /** Last 14 days, oldest first. */
  calendar: Array<{ day: string; mark: DayMark }>;
}

export function streakView(s: StreakState, today: string): StreakView {
  const active = new Set(s.activeDays);
  const frozen = new Set(s.freezeDays);
  const current = currentStreak(s, today);
  const calendar = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(today, i - 13);
    const mark: DayMark = active.has(day) ? 'active' : frozen.has(day) ? 'frozen' : day === today ? 'today' : 'missed';
    return { day, mark };
  });
  return {
    current,
    longest: Math.max(s.longest, current),
    doneToday: active.has(today),
    freezesLeft: freezesLeft(s, today),
    establishing: Math.max(s.longest, current) < ESTABLISH_DAYS,
    calendar,
  };
}

/** Days since the previous active day before `today` (for "welcome back" logic). */
export function daysAway(s: StreakState, today: string): number | null {
  const prev = s.activeDays.filter((d) => d < today).pop();
  return prev ? daysBetween(prev, today) : null;
}

export { monthKey, dayStart };
