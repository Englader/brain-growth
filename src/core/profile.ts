/**
 * Player profile: everything that must survive between sessions, as one JSON
 * document per child. Cheap to load, cheap to merge, and derivable in large
 * part from the log (replay) if it is ever lost or reshaped.
 */
import type { ChallengeDay } from './challenges';
import { glickoElo } from './engine/glicko';
import type { SkillState } from './engine/model';
import type { PlacementState } from './engine/placement';
import { startPlacement } from './engine/placement';
import { uid } from './hash';
import { emptyStreak, type StreakState } from './streaks';
import type { BandId, LocaleId, SkillId } from './types';
import type { WeeklyState } from './weekly';

export interface SprintRun {
  at: number;
  /** Total time with penalties (ms). */
  totalMs: number;
  correct: number;
  items: number;
  /** Cumulative ms after each item — the "ghost" to race next time. */
  splits: number[];
}

export interface Profile {
  id: string;
  name: string;
  age: number;
  band: BandId;
  bandOverridden: boolean;
  locale: LocaleId;
  /** Avatar/pet colour cosmetic id. */
  avatar: string;
  createdAt: number;
  updatedAt: number;
  modelId: string;
  skills: Record<SkillId, SkillState>;
  placement: { done: boolean; state: PlacementState | null; g?: number; sd?: number };
  streak: StreakState;
  achievements: Record<string, { at: number; seen: boolean }>;
  cosmetics: { owned: string[]; equipped: Record<string, string> };
  rewards: { itemsSinceDrop: number; pending: string[] };
  /** Monotonic lifetime counters (merge = max). */
  stats: { items: number; hops: number; sessions: number; xp: number; petTaps: number; localeSwitches: number };
  flags: Record<string, boolean>;
  settings: { sound: boolean; voice: boolean; noClock: boolean; petName: string | null };
  sprint: { best: SprintRun | null; history: Array<Omit<SprintRun, 'splits'>> };
  /** Daily quest (kept for old data; today's challenges replaced its card, DESIGN A-29). */
  quests: { day: string; ids: string[]; done: string[]; rewarded: boolean } | null;
  /** School year last chosen on the year bar (DESIGN A-29); null = the child's own year from age. */
  year: number | null;
  /** Today's challenges: pinned sets and ticks per year, and the day's gift (src/core/challenges.ts). */
  challenges: ChallengeDay | null;
  // Feature fields (add a default in createProfile and a rule in data/merge.ts), each under its own anchor:
  // ── slot: frac ──
  // ── slot: hint ──
  // ── slot: pilot ──
  // ── slot: storage ──
  // ── slot: weekly ──
  /** This week's pinned challenge theme and whether its set piece was granted (src/core/weekly.ts). */
  weekly: WeeklyState | null;
  // ── slot: target ──
  // ── slot: dice ──
  // ── slot: puzzle ──
  /** Per-puzzle-type rating (src/puzzles/rating.ts); never stored in `skills` (analytics look skill ids up in the graph). */
  puzzles: import('../puzzles/rating').PuzzleRatings;
  // ── slot: workshop ──
  // ── slot: balance ──
  // ── slot: coord ──
  // ── slot: season ──
}

export function defaultBandForAge(age: number): BandId {
  if (age <= 7) return 'A';
  if (age <= 11) return 'B';
  return 'C';
}

export interface NewProfileInput {
  name: string;
  age: number;
  locale: LocaleId;
  avatar: string;
  band?: BandId;
}

export function createProfile(input: NewProfileInput, now: number): Profile {
  const band = input.band ?? defaultBandForAge(input.age);
  return {
    id: uid('p'),
    name: input.name.trim().slice(0, 24) || '?',
    age: input.age,
    band,
    bandOverridden: band !== defaultBandForAge(input.age),
    locale: input.locale,
    avatar: input.avatar,
    createdAt: now,
    updatedAt: now,
    modelId: glickoElo.id,
    skills: {},
    placement: { done: false, state: startPlacement(input.age) },
    streak: emptyStreak(),
    achievements: {},
    cosmetics: { owned: [input.avatar], equipped: { color: input.avatar } },
    rewards: { itemsSinceDrop: 0, pending: [] },
    stats: { items: 0, hops: 0, sessions: 0, xp: 0, petTaps: 0, localeSwitches: 0 },
    flags: {},
    settings: { sound: true, voice: true, noClock: false, petName: null },
    sprint: { best: null, history: [] },
    quests: null,
    year: null,
    challenges: null,
    // Feature defaults, each under its own anchor:
    // ── slot: frac ──
    // ── slot: hint ──
    // ── slot: pilot ──
    // ── slot: storage ──
    // ── slot: weekly ──
    weekly: null,
    // ── slot: target ──
    // ── slot: dice ──
    // ── slot: puzzle ──
    puzzles: {},
    // ── slot: workshop ──
    // ── slot: balance ──
    // ── slot: coord ──
    // ── slot: season ──
  };
}

/** Fill fields added after a profile was written (cheap forward-compat for additive changes). */
export function normalizeProfile(p: Partial<Profile> & Pick<Profile, 'id'>): Profile {
  const base = createProfile({ name: p.name ?? '?', age: p.age ?? 8, locale: p.locale ?? 'en', avatar: p.avatar ?? 'color.green' }, p.createdAt ?? Date.now());
  return {
    ...base,
    ...p,
    stats: { ...base.stats, ...(p.stats ?? {}) },
    settings: { ...base.settings, ...(p.settings ?? {}) },
    rewards: { ...base.rewards, ...(p.rewards ?? {}) },
    cosmetics: { ...base.cosmetics, ...(p.cosmetics ?? {}) },
    sprint: { ...base.sprint, ...(p.sprint ?? {}) },
    streak: { ...base.streak, ...(p.streak ?? {}) },
    placement: p.placement ?? base.placement,
    id: p.id,
  } as Profile;
}
