/**
 * Today's challenges (DESIGN A-29, §1.9): a small daily set for the school
 * year a child is browsing. It replaced the daily quest card on the home.
 *
 *  - 3–4 challenges, deterministic per (child, year, day): the same all day
 *    on every device, different the next day.
 *  - Always one short practice (Number Trail on the year's skills) and, when
 *    puzzles are on, one puzzle; plus one or two extras that fit the year
 *    (Target, Workshop, Balance, Coordinates, a fraction/decimal practice,
 *    Sprint once a fact of that year is Solid). Too few extras for three
 *    challenges: a second puzzle type, else a quick spark.
 *  - The puzzle type rotates with the day, so two days in a row never have
 *    the same set while there are two puzzle types (every band has patterns
 *    and balances).
 *  - A tick is effort and completion: a session that ran to its end, a
 *    puzzle solved (hints and checks allowed). Finishing a set earns one
 *    unannounced gift per child per day, whichever year's set was first.
 *  - Nothing here knows about time left, resets or missed days (DESIGN §5.3).
 *
 * Pure: the app layer decides which extras fit (src/app/yearActions.ts).
 */
import { fnv1a } from './hash';
import { createRng } from './rng';
import { dayStart, DAY_MS } from './time';

/** Extras that may join the practice and the puzzle, in display order. */
export const EXTRA_KINDS = ['target', 'workshop', 'balance', 'coord', 'fracdec', 'sprint'] as const;
export type ExtraKind = (typeof EXTRA_KINDS)[number];
export type ChallengeKind = 'practice' | 'puzzle' | 'spark' | ExtraKind;

export interface Challenge {
  /** Unique within a day's set: the kind, or `puzzle.<type>` for a puzzle. */
  id: string;
  kind: ChallengeKind;
  /** The puzzle type of a `puzzle` challenge. */
  puzzleType?: string;
}

export interface DailyInput {
  pid: string;
  year: number;
  /** Local day key "YYYY-MM-DD". */
  day: string;
  /** Extras that fit this year for this child. */
  fits: readonly ExtraKind[];
  /** Puzzle types for the year (empty when puzzles are switched off). */
  puzzleTypes: readonly string[];
}

/** The fewest challenges in a set (practice, a puzzle and one more). */
export const MIN_CHALLENGES = 3;

const dayIndex = (day: string): number => Math.round(dayStart(day) / DAY_MS);

const puzzle = (type: string): Challenge => ({ id: `puzzle.${type}`, kind: 'puzzle', puzzleType: type });

/** Today's set for one year: deterministic in (pid, year, day, fits, puzzleTypes). */
export function dailyChallenges(input: DailyInput): Challenge[] {
  const { pid, year, day, puzzleTypes } = input;
  const fits = EXTRA_KINDS.filter((k) => input.fits.includes(k));
  const rng = createRng(fnv1a(`challenges|${pid}|${year}|${day}`));
  const set: Challenge[] = [{ id: 'practice', kind: 'practice' }];
  // The puzzle type steps one along each day (from a per-child, per-year offset), so consecutive days differ.
  const offset = fnv1a(`puzzles|${pid}|${year}`) % Math.max(1, puzzleTypes.length);
  const pIdx = puzzleTypes.length ? (dayIndex(day) + offset) % puzzleTypes.length : -1;
  if (pIdx >= 0) set.push(puzzle(puzzleTypes[pIdx]!));
  const want = fits.length >= 2 ? (rng.chance(0.5) ? 2 : 1) : fits.length;
  const extras = rng.shuffle(fits).slice(0, want);
  for (const k of EXTRA_KINDS) if (extras.includes(k)) set.push({ id: k, kind: k });
  if (set.length < MIN_CHALLENGES && puzzleTypes.length >= 2) set.push(puzzle(puzzleTypes[(pIdx + 1) % puzzleTypes.length]!));
  if (set.length < MIN_CHALLENGES) set.push({ id: 'spark', kind: 'spark' });
  return set;
}

/** Rebuild a challenge from its id (pinned sets store ids only). */
export function challengeFromId(id: string): Challenge | null {
  if (id === 'practice' || id === 'spark') return { id, kind: id };
  if (id.startsWith('puzzle.') && id.length > 7) return puzzle(id.slice(7));
  return (EXTRA_KINDS as readonly string[]).includes(id) ? { id, kind: id as ExtraKind } : null;
}

// ── per-child state: one day at a time ──────────────────────────────────────

/** `profile.challenges`: today's pinned sets and ticks per year, and whether today's gift was given. */
export interface ChallengeDay {
  day: string;
  /** Set per year (challenge ids), pinned at the first launch so it never moves under the child that day. */
  sets: Record<string, string[]>;
  /** Ticked challenge ids per year. */
  done: Record<string, string[]>;
  /** Today's gift was granted (once per child per day). */
  rewarded: boolean;
}

export function emptyDay(day: string): ChallengeDay {
  return { day, sets: {}, done: {}, rewarded: false };
}

/** The state for `day` (a new, empty one when the stored state is from another day). */
export function challengeDay(state: ChallengeDay | null | undefined, day: string): ChallengeDay {
  return state && state.day === day ? state : emptyDay(day);
}

/** Pin a year's set for the day (no-op when already pinned). */
export function pinSet(state: ChallengeDay, year: number, ids: readonly string[]): ChallengeDay {
  const y = String(year);
  return state.sets[y] ? state : { ...state, sets: { ...state.sets, [y]: [...ids] } };
}

export function isTicked(state: ChallengeDay, year: number, id: string): boolean {
  return (state.done[String(year)] ?? []).includes(id);
}

/** Tick one challenge (idempotent). */
export function tick(state: ChallengeDay, year: number, id: string): ChallengeDay {
  if (isTicked(state, year, id)) return state;
  const y = String(year);
  return { ...state, done: { ...state.done, [y]: [...(state.done[y] ?? []), id] } };
}

/** Every challenge of the year's pinned set is ticked. */
export function setComplete(state: ChallengeDay, year: number): boolean {
  const ids = state.sets[String(year)];
  return !!ids?.length && ids.every((id) => isTicked(state, year, id));
}

/**
 * Merge rule (backup import): the later day wins; on the same day, ticks are
 * a union per year, a year's pinned set is kept (the first copy's when both
 * have one) and the gift flag is an OR. Idempotent and monotone.
 */
export function mergeChallenges(a: ChallengeDay | null | undefined, b: ChallengeDay | null | undefined): ChallengeDay | null {
  if (!a) return b ?? null;
  if (!b) return a;
  if (a.day !== b.day) return a.day > b.day ? a : b;
  const years = new Set([...Object.keys(a.done), ...Object.keys(b.done)]);
  const done: Record<string, string[]> = {};
  for (const y of years) done[y] = [...new Set([...(a.done[y] ?? []), ...(b.done[y] ?? [])])];
  return { day: a.day, sets: { ...b.sets, ...a.sets }, done, rewarded: a.rewarded || b.rewarded };
}
