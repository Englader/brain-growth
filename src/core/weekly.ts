/**
 * Weekly themed challenge (DESIGN §1.9, plan step 6): a 5-session set on a
 * theme such as "Bridge week: crossing ten". The payoff is a cosmetic set
 * piece. It gives the week a shape without gating anything:
 *
 *  - The theme is picked by hashing the ISO week key, so siblings in the same
 *    band (with the same skills in play) get the same theme with no server.
 *  - Progress is participation, not accuracy: a session counts when it was
 *    completed and had at least 3 first attempts on theme skills. Quick
 *    sparks count like any other session.
 *  - The reward is granted once per week. Themes recur, so a missed week is
 *    never final, and weekly set pieces never drop at random.
 *  - Nothing here knows or exposes how many days are left, when the week
 *    resets, or what happens if the set is not finished (DESIGN §5.3: no
 *    countdowns, no loss framing, no FOMO).
 *
 * Pure and language-neutral: themes carry ids, the UI resolves the keys in
 * `weeklyKeys`.
 */
import type { CosmeticDef } from './rewards/cosmetics';
import { fnv1a } from './hash';
import type { LogRecord } from './log/types';
import { weekKey as weekKeyOf } from './time';
import type { BandId, SkillId } from './types';

export interface WeeklyTheme {
  id: string;
  bands: readonly BandId[];
  /** Theme skills. Empty means every skill counts (the mixed fallback). */
  skills: readonly SkillId[];
  /** Set-piece cosmetic id (`weekly.*`) for each band the theme runs in. */
  reward: Readonly<Partial<Record<BandId, string>>>;
}

export const MIXED_THEME_ID = 'mixed';

/** Sessions that complete the weekly set. */
export const WEEKLY_SESSIONS = 5;
/** First attempts on theme skills that make a session count. */
export const WEEKLY_ITEMS_PER_SESSION = 3;
/** Scheduler weight multiplier for theme skills (frontier and review only). */
export const WEEKLY_BOOST = 3;

export const WEEKLY_THEMES: readonly WeeklyTheme[] = [
  {
    id: 'counting',
    bands: ['A'],
    skills: ['num.subitize.5', 'num.subitize.10', 'num.count.10', 'num.count.20'],
    reward: { A: 'weekly.counting.pad' },
  },
  {
    id: 'bonds',
    bands: ['A'],
    skills: ['as.bonds.5', 'as.bonds.10', 'as.add.10', 'as.sub.10'],
    reward: { A: 'weekly.bonds.color' },
  },
  {
    id: 'bridgeTen',
    bands: ['A', 'B'],
    skills: ['as.add.20', 'as.sub.20'],
    reward: { A: 'weekly.bridgeTen.pad', B: 'weekly.bridgeTen.pad' },
  },
  {
    id: 'doubles',
    bands: ['A', 'B'],
    skills: ['md.groups', 'md.mult.2510', 'as.add.20'],
    reward: { A: 'weekly.doubles.color', B: 'weekly.doubles.color' },
  },
  {
    id: 'tens',
    bands: ['A', 'B'],
    skills: ['pv.tens.100', 'as.add.100.noregroup', 'as.sub.100.noregroup', 'as.add.100', 'as.sub.100'],
    reward: { A: 'weekly.tens.pad', B: 'weekly.tens.pad' },
  },
  {
    id: 'bridgeHundred',
    bands: ['B', 'C'],
    skills: ['as.add.multi', 'as.sub.multi', 'pv.1000'],
    reward: { B: 'weekly.bridgeHundred.pad', C: 'weekly.bridgeHundred.theme' },
  },
  {
    id: 'tables',
    bands: ['B', 'C'],
    skills: ['md.mult.facts', 'md.div.facts', 'md.mult.2510'],
    reward: { B: 'weekly.tables.color', C: 'weekly.tables.theme' },
  },
  {
    id: 'bigNumbers',
    bands: ['B', 'C'],
    skills: ['md.mult.10s', 'md.mult.multi'],
    reward: { B: 'weekly.bigNumbers.pad', C: 'weekly.bigNumbers.theme' },
  },
  {
    id: 'numberLine',
    bands: ['A', 'B', 'C'],
    skills: ['num.line.10', 'num.line.20', 'num.line.100', 'num.line.1000', 'int.intro'],
    reward: { A: 'weekly.numberLine.pad', B: 'weekly.numberLine.pad', C: 'weekly.numberLine.theme' },
  },
  {
    id: 'belowZero',
    bands: ['B', 'C'],
    skills: ['int.intro', 'int.addsub'],
    reward: { B: 'weekly.belowZero.color', C: 'weekly.belowZero.theme' },
  },
];

/** The fallback when no theme has an unlocked skill: every skill counts. */
export const MIXED_THEME: WeeklyTheme = {
  id: MIXED_THEME_ID,
  bands: ['A', 'B', 'C'],
  skills: [],
  reward: { A: 'weekly.mixed.pad', B: 'weekly.mixed.pad', C: 'weekly.mixed.theme' },
};

export function getWeeklyTheme(id: string): WeeklyTheme | undefined {
  return id === MIXED_THEME_ID ? MIXED_THEME : WEEKLY_THEMES.find((t) => t.id === id);
}

/**
 * Set pieces, as data (the integration registers them in `cosmetics.ts`).
 * `source: 'weekly'` keeps them out of the random drop pool. A/B get pads and
 * pet colours; C gets accent themes (nothing cute).
 */
export type WeeklyCosmeticDef = CosmeticDef & { source: 'weekly' };

const AB: readonly BandId[] = ['A', 'B'];
const C: readonly BandId[] = ['C'];
const piece = (id: string, slot: 'pad' | 'color' | 'theme', value: string): WeeklyCosmeticDef => ({
  id,
  slot,
  bands: slot === 'theme' ? C : AB,
  rarity: 2,
  value,
  source: 'weekly',
});

export const WEEKLY_COSMETICS: readonly WeeklyCosmeticDef[] = [
  piece('weekly.counting.pad', 'pad', '#c4b5fd'),
  piece('weekly.bonds.color', 'color', '#fb7185'),
  piece('weekly.bridgeTen.pad', 'pad', '#a5f3fc'),
  piece('weekly.doubles.color', 'color', '#84cc16'),
  piece('weekly.tens.pad', 'pad', '#fcd34d'),
  piece('weekly.bridgeHundred.pad', 'pad', '#f9a8d4'),
  piece('weekly.tables.color', 'color', '#6366f1'),
  piece('weekly.bigNumbers.pad', 'pad', '#d9f99d'),
  piece('weekly.numberLine.pad', 'pad', '#bae6fd'),
  piece('weekly.belowZero.color', 'color', '#0ea5e9'),
  piece('weekly.mixed.pad', 'pad', '#e9d5ff'),
  piece('weekly.bridgeHundred.theme', 'theme', '#fb923c'),
  piece('weekly.tables.theme', 'theme', '#a78bfa'),
  piece('weekly.bigNumbers.theme', 'theme', '#4ade80'),
  piece('weekly.numberLine.theme', 'theme', '#38bdf8'),
  piece('weekly.belowZero.theme', 'theme', '#60a5fa'),
  piece('weekly.mixed.theme', 'theme', '#e879f9'),
];

/** Does a first attempt on `skill` count toward `theme`? */
export function isThemeSkill(theme: WeeklyTheme, skill: SkillId): boolean {
  return theme.skills.length === 0 || theme.skills.includes(skill);
}

/**
 * This week's theme for a child. Every theme for the band is ranked by a hash
 * of (week, theme id), and the child gets the highest-ranked theme that has at
 * least one skill in `unlockedSkills` (else the mixed fallback). Siblings in
 * the same band therefore agree whenever the top-ranked theme is open to both,
 * and the ranking reshuffles every week.
 *
 * `unlockedSkills` should be skills the scheduler can still serve at frontier
 * or review weight (the boost does not touch maintenance), e.g. unlocked and
 * not yet mastered.
 */
export function themeFor(week: string, band: BandId, unlockedSkills: Iterable<SkillId>): WeeklyTheme {
  const open = new Set(unlockedSkills);
  const ranked = WEEKLY_THEMES.filter((t) => t.bands.includes(band))
    .map((t) => ({ t, h: fnv1a(`weekly|${week}|${t.id}`) }))
    .sort((x, y) => y.h - x.h || (x.t.id < y.t.id ? -1 : 1));
  return ranked.find(({ t }) => t.skills.some((s) => open.has(s)))?.t ?? MIXED_THEME;
}

/** The set piece a band earns for a theme (null if the theme does not run in that band). */
export function rewardFor(theme: WeeklyTheme, band: BandId): string | null {
  return theme.reward[band] ?? null;
}

export interface WeeklyProgress {
  week: string;
  theme: string;
  /** Sessions that counted, capped at `target` (Band A shows these as lit stones). */
  sessions: number;
  target: number;
  complete: boolean;
}

/**
 * Progress on this week's set from the child's log. A session counts when its
 * END record falls in `week`, it was completed, and it holds at least
 * WEEKLY_ITEMS_PER_SESSION first attempts on theme skills (right or wrong).
 */
export function weeklyProgress(records: readonly LogRecord[], week: string, theme: WeeklyTheme): WeeklyProgress {
  const ended = new Set<string>();
  for (const r of records) {
    if (r.type === 'session' && r.phase === 'end' && r.completed && weekKeyOf(r.ts) === week) ended.add(r.sid);
  }
  const firsts = new Map<string, Set<string>>();
  for (const r of records) {
    if (r.type !== 'item' || r.attempt !== 1 || !ended.has(r.sid) || !isThemeSkill(theme, r.skill)) continue;
    const keys = firsts.get(r.sid) ?? new Set<string>();
    keys.add(r.key); // a duplicated record (merged devices) counts once
    firsts.set(r.sid, keys);
  }
  let n = 0;
  for (const keys of firsts.values()) if (keys.size >= WEEKLY_ITEMS_PER_SESSION) n++;
  const sessions = Math.min(n, WEEKLY_SESSIONS);
  return { week, theme: theme.id, sessions, target: WEEKLY_SESSIONS, complete: sessions >= WEEKLY_SESSIONS };
}

/** Profile field (added by the integration): which week, and whether its set piece was granted. */
export interface WeeklyState {
  week: string;
  rewarded: boolean;
}

/**
 * Grant this week's set piece at most once. Returns the new state and whether
 * to grant now; the caller adds `rewardFor(theme, band)` to `pending`.
 * Progress for an older week than the state's never changes anything.
 */
export function weeklyReward(state: WeeklyState | null, progress: WeeklyProgress): { state: WeeklyState; grant: boolean } {
  if (state && state.week > progress.week) return { state, grant: false };
  const current = state && state.week === progress.week ? state : { week: progress.week, rewarded: false };
  if (current.rewarded || !progress.complete) return { state: current, grant: false };
  return { state: { week: progress.week, rewarded: true }, grant: true };
}

/** Merge two devices' copies: the later week wins; within a week, "rewarded" wins. */
export function mergeWeekly(a: WeeklyState | null, b: WeeklyState | null): WeeklyState | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  if (a.week !== b.week) return a.week > b.week ? { ...a } : { ...b };
  return { week: a.week, rewarded: a.rewarded || b.rewarded };
}

export type ScheduleBucket = 'frontier' | 'review' | 'maintain';

export interface ThemeBoost {
  skills: ReadonlySet<SkillId>;
  factor: number;
}

/** What a themed session passes to the scheduler. The mixed theme boosts nothing. */
export function themeBoost(theme: WeeklyTheme): ThemeBoost {
  return { skills: new Set(theme.skills), factor: WEEKLY_BOOST };
}

/** A candidate's weight under a boost: frontier and review ×factor, maintenance unchanged. */
export function boostedWeight(boost: ThemeBoost | null | undefined, skill: SkillId, bucket: ScheduleBucket, weight: number): number {
  if (!boost || bucket === 'maintain' || !boost.skills.has(skill)) return weight;
  return weight * boost.factor;
}

/**
 * Message keys the UI needs (strings in the `weekly` block, `cos.weekly.*`
 * and `voice.weekly.*`). None take a time, date or days parameter.
 */
export const WEEKLY_KEYS = {
  /** Card heading (B/C). */
  title: 'weekly.title',
  /** Band B button: "Play this week's challenge". */
  play: 'weekly.play',
  /** params: { done, target } (sessions). */
  progress: 'weekly.progress',
  /** The set is complete for this week. */
  complete: 'weekly.complete',
  /** Results extras line when a session lit a stone. params: { done, target } */
  stone: 'weekly.stone',
  /** Results extras line when the set piece is granted. */
  reward: 'weekly.reward',
  /** Spoken (Band A): a stone lit / the set complete. */
  voiceStone: 'voice.weekly.stone',
  voiceComplete: 'voice.weekly.complete',
} as const;

export const weeklyThemeNameKey = (theme: WeeklyTheme): string => `weekly.theme.${theme.id}.name`;
export const weeklyThemeDescKey = (theme: WeeklyTheme): string => `weekly.theme.${theme.id}.desc`;
