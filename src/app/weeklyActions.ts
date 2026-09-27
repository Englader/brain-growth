/**
 * Weekly themed challenge: the glue between the pure core (src/core/weekly.ts)
 * and profiles, the log and sessions. actions.ts calls three hooks:
 *   openProfile     → pinWeeklyFor   (this week's theme is fixed once chosen)
 *   startSessionFor → weeklyBoostFor (a session started from the card boosts theme skills)
 *   finishSession   → settleWeekly   (a lit stone, and the set piece once per week)
 * Everything here takes the profile explicitly (pass-and-play safe) and
 * returns updated, unsaved profiles; the caller saves.
 */
import { getBand } from '../bands/registry';
import { glickoElo } from '../core/engine/glicko';
import { classify } from '../core/engine/scheduler';
import { isEnabled } from '../core/flags';
import { EVENTS } from '../core/log/types';
import type { Profile } from '../core/profile';
import { pickCosmetic } from '../core/rewards/drops';
import type { Rng } from '../core/rng';
import { createRng } from '../core/rng';
import { GRAPH } from '../core/skills';
import { weekKey } from '../core/time';
import type { SkillId } from '../core/types';
import {
  getWeeklyTheme,
  MIXED_THEME,
  pinWeekly,
  rewardFor,
  sessionCounts,
  themeBoost,
  themeFor,
  weeklyProgress,
  weeklyReward,
  WEEKLY_KEYS,
  type ThemeBoost,
  type WeeklyProgress,
  type WeeklyState,
  type WeeklyTheme,
} from '../core/weekly';
import type { MessageParams } from '../i18n/format';
import { getMode } from '../modes/registry';
import { appendLog, event, recentLog } from './persist';
import { getState } from './store';

/** The weekly challenge is on for this child (profile flag, device flag, URL override; default on). */
export function weeklyOn(p: Profile): boolean {
  return isEnabled('weekly', p.flags, getState().meta?.deviceFlags ?? {});
}

/** Shown and tracked only once placement is done (the theme is chosen from real skill states). */
function active(p: Profile): boolean {
  return p.placement.done && weeklyOn(p);
}

/**
 * How far past the child's earliest learning gap (in grades) a frontier skill
 * may be and still anchor a theme. The scheduler already fades skills that
 * far ahead; a themed week must not turn a stretch skill into half of every
 * session.
 */
export const THEME_REACH_GRADES = 1.5;

/**
 * Skills a themed Hop session could boost right now: the ones the scheduler
 * puts in its review bucket (due, at or above the band's review floor) or its
 * frontier (unlocked and not yet mastered) within THEME_REACH_GRADES of the
 * earliest gap. Never maintenance, so strong children can still finish.
 */
export function skillsInPlay(p: Profile, t: number): SkillId[] {
  const hop = getMode('hop');
  const band = getBand(p.band);
  const { frontier, review } = classify({
    graph: GRAPH,
    model: glickoElo,
    states: p.skills,
    now: t,
    rng: createRng(0),
    eligibility: { requires: hop?.requires ?? ['numberLine'], allowReading: band.allowReading, reviewFloor: band.reviewFloorGrade },
    history: [],
    newIntroduced: 0,
  });
  const learning = frontier.filter((c) => c.learning);
  const g0 = Math.min(...(learning.length ? learning : frontier).map((c) => c.skill.grade));
  const near = frontier.filter((c) => c.skill.grade <= g0 + THEME_REACH_GRADES);
  return [...new Set([...near, ...review].map((c) => c.skill.id))];
}

/** This week's state for `p` (pinned if it already is; otherwise what pinning would choose). */
export function weeklyStateFor(p: Profile, t: number): WeeklyState {
  const week = weekKey(t);
  return pinWeekly(p.weekly ?? null, week, p.band, () => themeFor(week, p.band, skillsInPlay(p, t)));
}

/** Pin this week's theme on the profile (unsaved). No-op when off or not placed yet. */
export function pinWeeklyFor(p: Profile, t: number): Profile {
  if (!active(p)) return p;
  const state = weeklyStateFor(p, t);
  const cur = p.weekly;
  return cur && cur.week === state.week && cur.theme === state.theme && cur.rewarded === state.rewarded ? p : { ...p, weekly: state };
}

export interface WeeklyView {
  theme: WeeklyTheme;
  progress: WeeklyProgress;
  /** The set piece this band earns for the theme. */
  reward: string | null;
  rewarded: boolean;
}

/** What the home card shows (null when the challenge is off or placement is pending). Pure read. */
export function weeklyView(p: Profile, t: number): WeeklyView | null {
  if (!active(p)) return null;
  const state = weeklyStateFor(p, t);
  const theme = getWeeklyTheme(state.theme) ?? MIXED_THEME;
  return { theme, progress: weeklyProgress(recentLog(p.id), state.week, theme), reward: rewardFor(theme, p.band), rewarded: state.rewarded };
}

/** The scheduler boost for a session started with `opts.theme` (none for the mixed theme or when off). */
export function weeklyBoostFor(p: Profile, themeId: string | undefined): ThemeBoost | undefined {
  if (!themeId || !weeklyOn(p)) return undefined;
  const theme = getWeeklyTheme(themeId);
  return theme && theme.skills.length ? themeBoost(theme) : undefined;
}

export interface WeeklySettlement {
  profile: Profile;
  gifts: string[];
  extras: Array<{ key: string; params?: MessageParams }>;
}

/**
 * After a session ends (its end record already logged): report a lit stone
 * and grant the week's set piece once the set is complete. If the child
 * already owns that set piece (themes recur), the gift is a surprise from
 * the ordinary drop pool instead, so finishing a set is never an empty
 * moment; with a complete collection there is simply no gift.
 */
export function settleWeekly(p: Profile, sid: string, t: number, rng: Rng): WeeklySettlement {
  const none: WeeklySettlement = { profile: p, gifts: [], extras: [] };
  if (!active(p)) return none;
  const state = weeklyStateFor(p, t);
  const theme = getWeeklyTheme(state.theme) ?? MIXED_THEME;
  const log = recentLog(p.id);
  let next: Profile = p.weekly === state ? p : { ...p, weekly: state };
  if (!sessionCounts(log, state.week, theme, sid)) return { ...none, profile: next };

  const progress = weeklyProgress(log, state.week, theme);
  const extras: WeeklySettlement['extras'] = [{ key: WEEKLY_KEYS.stone, params: { done: progress.sessions, target: progress.target } }];
  const gifts: string[] = [];
  const r = weeklyReward(state, progress);
  if (r.grant) {
    const have = [...next.cosmetics.owned, ...next.rewards.pending];
    const piece = rewardFor(theme, next.band);
    const gift = piece && !have.includes(piece) ? piece : pickCosmetic(have, next.band, rng)?.id ?? null;
    next = {
      ...next,
      weekly: r.state,
      rewards: gift ? { ...next.rewards, pending: [...next.rewards.pending, gift] } : next.rewards,
    };
    if (gift) gifts.push(gift);
    extras.push({ key: WEEKLY_KEYS.reward });
    appendLog(p.id, [event(EVENTS.WEEKLY_DONE, { week: state.week, theme: theme.id, reward: gift }, sid)]);
  }
  return { profile: next, gifts, extras };
}
