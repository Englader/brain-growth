/**
 * Weekly themed challenge (DESIGN §1.9, plan step 6): a 5-session set on a
 * theme such as "Bridge week: crossing ten". The payoff is a cosmetic set
 * piece. It gives the week a shape without gating anything:
 *
 *  - The theme is picked by hashing the ISO week key, so siblings in the same
 *    band (with the same skills in play) get the same theme with no server.
 *    It is pinned for the week once chosen, so progress never moves under
 *    the child's feet when new skills unlock mid-week.
 *  - Progress is participation, not accuracy: a session counts when it was
 *    completed and had at least 3 first attempts on theme skills, right or
 *    wrong. Quick sparks count like any other session.
 *  - The reward is granted once per week. Themes recur, so a missed week is
 *    never final, and weekly set pieces never drop at random.
 *  - Nothing here knows or exposes how many days are left, when the week
 *    resets, or what happens if the set is not finished (DESIGN §5.3: no
 *    countdowns, no loss framing, no FOMO).
 *
 * Pure and language-neutral: themes carry ids, the UI resolves the keys in
 * `WEEKLY_KEYS`, `weeklyThemeNameKey` and `cos.<set piece id>`.
 */
import { fnv1a } from './hash';
import type { LogRecord } from './log/types';
import { EVENTS } from './log/types';
import { COSMETICS, type CosmeticDef } from './rewards/cosmetics';
import { seasonForWeek, seasonWeekDescKey, seasonWeekKey, type SeasonId } from './seasons';
import { weekKey as weekKeyOf } from './time';
import type { BandId, SkillId } from './types';

export interface WeeklyTheme {
  id: string;
  bands: readonly BandId[];
  /** Theme skills. Empty means every skill counts (the mixed fallback). */
  skills: readonly SkillId[];
  /** Set-piece cosmetic id (`weekly.*`, or `season.*` for a seasonal week) for each band the theme runs in. */
  reward: Readonly<Partial<Record<BandId, string>>>;
  /** Set on the seasonal weeks' themes (SEASONAL_THEMES): the season whose week this is. */
  season?: SeasonId;
}

export const MIXED_THEME_ID = 'mixed';

/** Sessions that complete the weekly set. */
export const WEEKLY_SESSIONS = 5;
/** First attempts on theme skills that make a session count. */
export const WEEKLY_ITEMS_PER_SESSION = 3;
/** Scheduler weight multiplier for theme skills (frontier and review only). */
export const WEEKLY_BOOST = 3;
/**
 * Share of a themed session's scheduled items (after the warm-up) drawn
 * straight from the theme's frontier/review skills. The ×3 weight alone moves
 * the theme share from ~2% to ~5% when the frontier holds a dozen skills;
 * this draw puts it at about half the session (tests/weekly.test.ts).
 */
export const WEEKLY_THEME_SHARE = 0.5;

/**
 * Set pieces: Band A gets a patterned lily-pad set (A sees pads on every
 * item), Band B a pet colour (B plays on the ruler, where the pet shows),
 * Band C an accent theme (nothing cute).
 */
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
    reward: { A: 'weekly.bonds.pad' },
  },
  {
    id: 'bridgeTen',
    bands: ['A', 'B'],
    skills: ['as.add.20', 'as.sub.20'],
    reward: { A: 'weekly.bridgeTen.pad', B: 'weekly.bridgeTen.color' },
  },
  {
    id: 'doubles',
    bands: ['A', 'B'],
    skills: ['md.groups', 'md.mult.2510', 'as.add.20'],
    reward: { A: 'weekly.doubles.pad', B: 'weekly.doubles.color' },
  },
  {
    id: 'tens',
    bands: ['A', 'B'],
    skills: ['pv.tens.100', 'as.add.100.noregroup', 'as.sub.100.noregroup', 'as.add.100', 'as.sub.100'],
    reward: { A: 'weekly.tens.pad', B: 'weekly.tens.color' },
  },
  {
    id: 'bridgeHundred',
    bands: ['B', 'C'],
    skills: ['as.add.multi', 'as.sub.multi', 'pv.1000'],
    reward: { B: 'weekly.bridgeHundred.color', C: 'weekly.bridgeHundred.theme' },
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
    reward: { B: 'weekly.bigNumbers.color', C: 'weekly.bigNumbers.theme' },
  },
  {
    id: 'numberLine',
    bands: ['A', 'B', 'C'],
    skills: ['num.line.10', 'num.line.20', 'num.line.100', 'num.line.1000', 'int.intro'],
    reward: { A: 'weekly.numberLine.pad', B: 'weekly.numberLine.color', C: 'weekly.numberLine.theme' },
  },
  {
    id: 'belowZero',
    bands: ['B', 'C'],
    skills: ['int.intro', 'int.addsub'],
    reward: { B: 'weekly.belowZero.color', C: 'weekly.belowZero.theme' },
  },
];

/** The fallback when no theme has a skill in play: every skill counts, nothing is boosted. */
export const MIXED_THEME: WeeklyTheme = {
  id: MIXED_THEME_ID,
  bands: ['A', 'B', 'C'],
  skills: [],
  reward: { A: 'weekly.mixed.pad', B: 'weekly.mixed.color', C: 'weekly.mixed.theme' },
};

/**
 * Seasonal weeks (plan step 10): during Нова година and Велигден the week's
 * theme is the season's, for every band. Every game counts (no skill list,
 * so no scheduler boost and every child can finish), and the set piece is
 * the season's signature cosmetic: the frog's hat for A/B, an accent for C.
 * If the child already has it, settleWeekly gives a surprise from the drop
 * pool instead, where the season's other items are in play.
 */
export const SEASONAL_THEMES: readonly WeeklyTheme[] = [
  { id: 'newYear', season: 'newYear', bands: ['A', 'B', 'C'], skills: [], reward: { A: 'season.newYear.hat', B: 'season.newYear.hat', C: 'season.newYear.theme' } },
  { id: 'easter', season: 'easter', bands: ['A', 'B', 'C'], skills: [], reward: { A: 'season.easter.hat', B: 'season.easter.hat', C: 'season.easter.theme' } },
];

/**
 * The seasonal theme that overrides `themeFor` in `week`, or null. A whole
 * ISO week belongs to one season (judged on its Thursday: seasonForWeek), so
 * siblings share it and it never changes mid-week.
 */
export function seasonalThemeFor(week: string): WeeklyTheme | null {
  const season = seasonForWeek(week);
  return season ? SEASONAL_THEMES.find((t) => t.season === season) ?? null : null;
}

export function getWeeklyTheme(id: string): WeeklyTheme | undefined {
  return id === MIXED_THEME_ID ? MIXED_THEME : WEEKLY_THEMES.find((t) => t.id === id) ?? SEASONAL_THEMES.find((t) => t.id === id);
}

/** The registered set pieces (they live in the weekly slot of cosmetics.ts, `source: 'weekly'`). */
export const WEEKLY_COSMETICS: readonly CosmeticDef[] = COSMETICS.filter((c) => c.source === 'weekly');

/** Does a first attempt on `skill` count toward `theme`? */
export function isThemeSkill(theme: WeeklyTheme, skill: SkillId): boolean {
  return theme.skills.length === 0 || theme.skills.includes(skill);
}

/**
 * This week's theme for a child. Every theme for the band is ranked by a hash
 * of (week, theme id), and the child gets the highest-ranked theme that has at
 * least one skill in `inPlay` (else the mixed fallback). Siblings in the same
 * band therefore agree whenever the top-ranked theme is open to both, and the
 * ranking reshuffles every week.
 *
 * `inPlay` should be the skills the boost can act on: those the scheduler
 * would serve at frontier or review weight (unlocked and not yet mastered, or
 * due for review), so strong children can still finish the set.
 */
export function themeFor(week: string, band: BandId, inPlay: Iterable<SkillId>): WeeklyTheme {
  const open = new Set(inPlay);
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
  /** Sessions that counted, capped at `target` (shown as lit stones). */
  sessions: number;
  target: number;
  complete: boolean;
}

/** First attempts on theme skills per session id, for sessions that were completed in `week`. */
function themeFirstsBySession(records: readonly LogRecord[], week: string, theme: WeeklyTheme): Map<string, number> {
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
  return new Map([...firsts].map(([sid, keys]) => [sid, keys.size]));
}

/** Did session `sid` count toward the set? */
export function sessionCounts(records: readonly LogRecord[], week: string, theme: WeeklyTheme, sid: string): boolean {
  return (themeFirstsBySession(records, week, theme).get(sid) ?? 0) >= WEEKLY_ITEMS_PER_SESSION;
}

/**
 * Progress on this week's set from the child's log. A session counts when its
 * END record falls in `week`, it was completed, and it holds at least
 * WEEKLY_ITEMS_PER_SESSION first attempts on theme skills (right or wrong).
 */
export function weeklyProgress(records: readonly LogRecord[], week: string, theme: WeeklyTheme): WeeklyProgress {
  let n = 0;
  for (const count of themeFirstsBySession(records, week, theme).values()) if (count >= WEEKLY_ITEMS_PER_SESSION) n++;
  const sessions = Math.min(n, WEEKLY_SESSIONS);
  return { week, theme: theme.id, sessions, target: WEEKLY_SESSIONS, complete: sessions >= WEEKLY_SESSIONS };
}

/** Profile field `weekly`: this week's pinned theme and whether its set piece was granted. */
export interface WeeklyState {
  week: string;
  theme: string;
  rewarded: boolean;
}

/**
 * This week's state: the pinned one when it is for `week` and its theme runs
 * in `band`; otherwise a fresh pin from `pick()` (a new week, or an adult
 * changed the child's band), keeping `rewarded` within the same week.
 */
export function pinWeekly(state: WeeklyState | null, week: string, band: BandId, pick: () => WeeklyTheme): WeeklyState {
  if (state && state.week === week) {
    const theme = getWeeklyTheme(state.theme);
    if (theme && theme.bands.includes(band)) return state;
    return { week, theme: pick().id, rewarded: state.rewarded };
  }
  return { week, theme: pick().id, rewarded: false };
}

/**
 * Grant this week's set piece at most once. Returns the new state and whether
 * to grant now; the caller adds `rewardFor(theme, band)` to `pending`.
 * Progress for another week than the state's never changes anything.
 */
export function weeklyReward(state: WeeklyState, progress: WeeklyProgress): { state: WeeklyState; grant: boolean } {
  if (state.week !== progress.week || state.rewarded || !progress.complete) return { state, grant: false };
  return { state: { ...state, rewarded: true }, grant: true };
}

/**
 * Merge two devices' copies (idempotent, commutative, associative): the later
 * week wins; within a week "rewarded" wins, and so does the rewarded copy's
 * theme (else the smaller theme id, so both devices agree).
 */
export function mergeWeekly(a: WeeklyState | null, b: WeeklyState | null): WeeklyState | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  if (a.week !== b.week) return a.week > b.week ? { ...a } : { ...b };
  const rewarded = a.rewarded || b.rewarded;
  const candidates = rewarded ? [a, b].filter((x) => x.rewarded) : [a, b];
  const theme = candidates.map((x) => x.theme).sort()[0]!;
  return { week: a.week, theme, rewarded };
}

export type ScheduleBucket = 'frontier' | 'review' | 'maintain';

export interface ThemeBoost {
  skills: ReadonlySet<SkillId>;
  /** Frontier and review weight multiplier. */
  factor: number;
  /** Probability that a scheduled item is drawn from the theme's frontier/review candidates. */
  share: number;
}

/** What a themed session passes to the scheduler. The mixed theme boosts nothing. */
export function themeBoost(theme: WeeklyTheme): ThemeBoost {
  return { skills: new Set(theme.skills), factor: WEEKLY_BOOST, share: theme.skills.length ? WEEKLY_THEME_SHARE : 0 };
}

/** A candidate's weight under a boost: frontier and review ×factor, maintenance unchanged. */
export function boostedWeight(boost: ThemeBoost | null | undefined, skill: SkillId, bucket: ScheduleBucket, weight: number): number {
  if (!boost || bucket === 'maintain' || !boost.skills.has(skill)) return weight;
  return weight * boost.factor;
}

/**
 * Free-choice measure for the adult view (A-22): the share of a week's
 * first attempts answered after that week's set was completed. Null when no
 * set has been completed in the log.
 */
export function weeklyFreeChoice(records: readonly LogRecord[]): number | null {
  const doneAt = new Map<string, number>();
  for (const r of records) {
    if (r.type !== 'event' || r.name !== EVENTS.WEEKLY_DONE) continue;
    const w = weekKeyOf(r.ts);
    doneAt.set(w, Math.min(doneAt.get(w) ?? Infinity, r.ts));
  }
  if (!doneAt.size) return null;
  let total = 0;
  let after = 0;
  for (const r of records) {
    if (r.type !== 'item' || r.attempt !== 1) continue;
    const done = doneAt.get(weekKeyOf(r.ts));
    if (done === undefined) continue;
    total++;
    if (r.ts > done) after++;
  }
  return total ? after / total : null;
}

/**
 * Message keys the UI needs (strings in the `weekly` block, `cos.weekly.*`
 * and `voice.weekly.*`). None takes a time, date or days parameter.
 */
export const WEEKLY_KEYS = {
  /** Card heading. */
  title: 'weekly.title',
  /** Button that starts a themed session. */
  play: 'weekly.play',
  /** How a stone lights. */
  how: 'weekly.how',
  /** params: { done, target } (sessions). */
  progress: 'weekly.progress',
  /** The set is complete for this week. */
  complete: 'weekly.complete',
  /** Results extras line when a session lit a stone. params: { done, target } */
  stone: 'weekly.stone',
  /** Results extras line when the set piece is granted. */
  reward: 'weekly.reward',
  /** Adult overview: free-choice after the set. params: { pct } */
  freeChoice: 'weekly.adult.freeChoice',
  freeChoiceNone: 'weekly.adult.freeChoiceNone',
  /** Adult feature switch label. */
  flag: 'weekly.flag',
  /** Spoken (Band A card): what the stones are / the set is complete. */
  voiceIntro: 'voice.weekly.intro',
  voiceDone: 'voice.weekly.done',
} as const;

export const weeklyThemeNameKey = (theme: WeeklyTheme): string => (theme.season ? seasonWeekKey(theme.season) : `weekly.theme.${theme.id}.name`);
export const weeklyThemeDescKey = (theme: WeeklyTheme): string => (theme.season ? seasonWeekDescKey(theme.season) : `weekly.theme.${theme.id}.desc`);
