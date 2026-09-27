/**
 * The year bar and today's challenges (DESIGN A-29): the glue between the
 * pure cores (src/core/years.ts, src/core/challenges.ts), the mode registry
 * and a child's profile and log.
 *
 *  - A year has content for a mode when a playable skill of that year is one
 *    the mode can serve to this child (its capabilities and filter, and the
 *    band's reading rule). The year bar lists the years with content in any
 *    visible engine mode; puzzles exist in every year and do not count.
 *  - In a year, a mode is ready when the engine would have something to serve
 *    there and placement is done (Number Trail places, so it never waits).
 *    Unlocking does not matter: a chosen year has no walls.
 *  - finishSession and the puzzle track call the settle functions below to
 *    tick a challenge; the first complete set of the day brings one gift and
 *    counts as the day's quest (a `quest_done` event).
 * Everything takes the profile explicitly and returns it unsaved, like the
 * other feature action modules; only chooseYear and launchChallenge save.
 */
import { getBand } from '../bands/registry';
import {
  challengeDay,
  challengeFromId,
  dailyChallenges,
  isTicked,
  pinSet,
  setComplete,
  tick,
  type Challenge,
  type ChallengeDay,
  type ExtraKind,
} from '../core/challenges';
import { compatibleBindings } from '../core/engine/scheduler';
import { EVENTS, type SessionOptions } from '../core/log/types';
import type { Profile } from '../core/profile';
import { pickCosmetic } from '../core/rewards/drops';
import type { Rng } from '../core/rng';
import { GRAPH } from '../core/skills';
import type { SkillDef } from '../core/skills/types';
import { dayKey } from '../core/time';
import type { ModeId } from '../core/types';
import { inYear, MAX_YEAR, nearestYear, ownYear, puzzleTypeIdsFor, puzzleTypesForYear } from '../core/years';
import type { MessageParams } from '../i18n/format';
import { getMode, isReady, modesFor } from '../modes/registry';
import type { ModeDef } from '../modes/types';
import { appendLog, event, saveProfile } from './persist';
import { seasonalDropDate } from './seasonActions';
import { now } from './services';
import { getState } from './store';

const deviceFlags = (): Record<string, boolean> => getState().meta?.deviceFlags ?? {};

const FRAC_DEC = new Set(['fractions', 'decimals']);
const isFracDec = (s: SkillDef): boolean => FRAC_DEC.has(s.strand);

/** The skill filter a session's `focus` adds (none without one). */
export function focusFilter(focus: SessionOptions['focus']): ((s: SkillDef) => boolean) | undefined {
  return focus === 'fracdec' ? isFracDec : undefined;
}

/** Playable skills of `year` that `mode` can serve to this child (capabilities, the mode's filter, the band's reading rule). */
export function modeYearSkills(mode: ModeDef, p: Profile, year: number): SkillDef[] {
  const elig = { requires: mode.requires, allowReading: getBand(p.band).allowReading };
  return GRAPH.playableSkills().filter(
    (s) => inYear(s, year) && compatibleBindings(s, elig).length > 0 && (!mode.filter || mode.filter(s, p.skills[s.id])),
  );
}

/** Engine modes visible to this child (standalone modes like puzzles and Dice Race have no year content). */
function engineModes(p: Profile): ModeDef[] {
  return modesFor(p, deviceFlags()).filter((m) => m.engine !== false);
}

/** Years (ascending) with content in at least one visible engine mode for this child. */
export function yearsFor(p: Profile): number[] {
  const modes = engineModes(p);
  const out: number[] = [];
  for (let y = 0; y <= MAX_YEAR; y++) if (modes.some((m) => modeYearSkills(m, p, y).length > 0)) out.push(y);
  return out;
}

/** The year the bar shows: the last one chosen, else the child's own; moved to the nearest year with content. */
export function selectedYear(p: Profile): number {
  return nearestYear(p.year ?? ownYear(p.age), yearsFor(p)) ?? ownYear(p.age);
}

/** Choose a year on the active child's bar (remembered on the profile). */
export function chooseYear(year: number): void {
  const p = getState().profile;
  if (!p || p.year === year) return;
  saveProfile({ ...p, year });
}

/**
 * Whether `mode` can be started in `year`: standalone modes as always (puzzles
 * follow the year inside), engine modes when they have content there and,
 * except for Number Trail, once placement is done. Before placement Number
 * Trail can always start: its first session places the child in any year.
 */
export function modeReadyInYear(mode: ModeDef, p: Profile, year: number): boolean {
  if (mode.engine === false) return isReady(mode, p);
  if (mode.placement && !p.placement.done) return true;
  if (!modeYearSkills(mode, p, year).length) return false;
  return !!mode.placement || p.placement.done;
}

/** For a mode with nothing in `year`: the nearest year where it has content (null when none). */
export function nearestYearFor(mode: ModeDef, p: Profile, year: number): number | null {
  const years: number[] = [];
  for (let y = 0; y <= MAX_YEAR; y++) if (modeYearSkills(mode, p, y).length) years.push(y);
  return nearestYear(year, years);
}

// ── today's challenges ─────────────────────────────────────────────────────

/** Challenges switch with the daily quest's flag (they replaced its card; DESIGN A-22, A-29). */
export function challengesOn(p: Profile): boolean {
  return p.flags['quests.daily'] ?? deviceFlags()['quests.daily'] ?? true;
}

/** The year's practice mode: Number Trail when it can start there, else the first engine mode with content (Balance in year 8). */
export function practiceMode(p: Profile, year: number): ModeDef | null {
  const hop = getMode('hop');
  if (hop && modeReadyInYear(hop, p, year)) return hop;
  return engineModes(p).find((m) => modeReadyInYear(m, p, year)) ?? null;
}

const EXTRA_MODE: Record<Exclude<ExtraKind, 'fracdec'>, ModeId> = { target: 'target', workshop: 'workshop', balance: 'balance', coord: 'coord', sprint: 'sprint' };

/** Extras that fit the year for this child: a visible mode with content there (Sprint: a Solid fact of that year), a real fraction/decimal focus. */
export function extrasFor(p: Profile, year: number): ExtraKind[] {
  const visible = new Map(modesFor(p, deviceFlags()).map((m) => [m.id, m]));
  const practice = practiceMode(p, year)?.id;
  const out: ExtraKind[] = [];
  for (const [kind, id] of Object.entries(EXTRA_MODE) as Array<[ExtraKind, ModeId]>) {
    const m = visible.get(id);
    if (m && id !== practice && modeYearSkills(m, p, year).length) out.push(kind);
  }
  const hop = visible.get('hop');
  const hopSkills = hop ? modeYearSkills(hop, p, year) : [];
  // A focus only when the year mixes fractions or decimals with other skills (otherwise it is the practice again).
  if (hopSkills.some(isFracDec) && hopSkills.some((s) => !isFracDec(s))) out.push('fracdec');
  return out;
}

function puzzleTypes(p: Profile, year: number): string[] {
  const puzzle = modesFor(p, deviceFlags()).find((m) => m.id === 'puzzle');
  return puzzle ? puzzleTypesForYear(year, p.band, puzzleTypeIdsFor) : [];
}

/** The set the rules give now (before it is pinned). */
function computedSet(p: Profile, year: number, day: string): Challenge[] {
  return dailyChallenges({ pid: p.id, year, day, fits: extrasFor(p, year), puzzleTypes: puzzleTypes(p, year) });
}

/** Today's set for a year: the pinned one when a challenge was already launched today, else what the rules give. */
export function todaysSet(p: Profile, year: number, t: number): Challenge[] {
  const day = dayKey(t);
  const pinned = challengeDay(p.challenges, day).sets[String(year)];
  if (pinned) return pinned.map(challengeFromId).filter((c): c is Challenge => c !== null);
  return computedSet(p, year, day);
}

/** Pin the year's set for today (unsaved). */
export function pinToday(p: Profile, year: number, t: number): Profile {
  const day = dayKey(t);
  const state = challengeDay(p.challenges, day);
  if (state.sets[String(year)]) return state === p.challenges ? p : { ...p, challenges: state };
  return { ...p, challenges: pinSet(state, year, computedSet(p, year, day).map((c) => c.id)) };
}

export interface ChallengeView {
  challenge: Challenge;
  done: boolean;
  /** It can be started now (before placement only the practice can). */
  open: boolean;
  /** The mode it launches (null when it cannot be played now, e.g. switched off). */
  mode: ModeDef | null;
}

export interface TodayView {
  year: number;
  items: ChallengeView[];
  done: number;
  complete: boolean;
  /** Today's gift was already given (for any year). */
  rewarded: boolean;
}

/** What the home card shows for a year (null when challenges are switched off). Pure read. */
export function todayView(p: Profile, year: number, t: number): TodayView | null {
  if (!challengesOn(p)) return null;
  const state = challengeDay(p.challenges, dayKey(t));
  const items = todaysSet(p, year, t).map((c): ChallengeView => {
    const mode = challengeMode(c, p, year);
    const done = isTicked(state, year, c.id);
    const open = !!mode && (c.kind === 'practice' || p.placement.done) && modeReadyInYear(mode, p, year);
    return { challenge: c, done, open, mode };
  });
  const done = items.filter((i) => i.done).length;
  return { year, items, done, complete: items.length > 0 && done === items.length, rewarded: state.rewarded };
}

/** The mode a challenge plays. */
export function challengeMode(c: Challenge, p: Profile, year: number): ModeDef | null {
  const visible = (id: ModeId): ModeDef | null => modesFor(p, deviceFlags()).find((m) => m.id === id) ?? null;
  switch (c.kind) {
    case 'practice':
      return practiceMode(p, year);
    case 'spark':
    case 'fracdec':
      return visible('hop');
    case 'puzzle':
      return visible('puzzle');
    default:
      return visible(EXTRA_MODE[c.kind]);
  }
}

/** Short sessions: about six problems of practice, a few constructions or deals. */
export const CHALLENGE_ITEMS = { practice: 6, placing: 8, focus: 6, mode: 4 } as const;

/** Session options for a challenge in `year`. */
export function challengeOptions(c: Challenge, p: Profile, year: number, mode: ModeDef): SessionOptions {
  const base: SessionOptions = { year, challenge: c.id };
  switch (c.kind) {
    case 'practice':
      if (mode.id !== 'hop') return { ...base, items: CHALLENGE_ITEMS.mode };
      // Placement runs in the first Number Trail session (≤ 8 items), whatever the year.
      return { ...base, items: p.placement.done ? CHALLENGE_ITEMS.practice : CHALLENGE_ITEMS.placing };
    case 'spark':
      return { ...base, quick: true };
    case 'fracdec':
      return { ...base, focus: 'fracdec', items: CHALLENGE_ITEMS.focus };
    case 'puzzle':
    case 'sprint':
      return base;
    default:
      return { ...base, items: CHALLENGE_ITEMS.mode };
  }
}

/** Pin today's set, save, and return how to launch the challenge (null when it cannot start now). */
export function prepareChallenge(c: Challenge, year: number): { mode: ModeDef; opts: SessionOptions } | null {
  const p = getState().profile;
  if (!p) return null;
  const view = todayView(p, year, now())?.items.find((i) => i.challenge.id === c.id);
  if (!view?.open || !view.mode) return null;
  saveProfile(pinToday(p, year, now()));
  return { mode: view.mode, opts: challengeOptions(c, p, year, view.mode) };
}

export interface ChallengeSettlement {
  profile: Profile;
  gifts: string[];
  extras: Array<{ key: string; params?: MessageParams }>;
}

/**
 * Tick challenge `id` of `year` (after a completed session or a solved
 * puzzle). The first set completed today brings one gift into `pending` and
 * a `quest_done` event, so it counts as the day's quest for the free-choice
 * measure and any quest metric. Unsaved.
 */
export function tickChallenge(p: Profile, year: number, id: string, sid: string | null, t: number, rng: Rng): ChallengeSettlement {
  const none: ChallengeSettlement = { profile: p, gifts: [], extras: [] };
  if (!challengesOn(p)) return none;
  const pinned = pinToday(p, year, t);
  let state: ChallengeDay = pinned.challenges!;
  const ids = state.sets[String(year)] ?? [];
  if (!ids.includes(id) || isTicked(state, year, id)) return { ...none, profile: pinned };
  state = tick(state, year, id);
  const done = ids.filter((x) => isTicked(state, year, x)).length;
  const extras: ChallengeSettlement['extras'] = [{ key: 'year.today.ticked', params: { done, total: ids.length } }];
  const gifts: string[] = [];
  let next: Profile = { ...pinned, challenges: state };
  if (setComplete(state, year) && !state.rewarded) {
    const c = pickCosmetic([...next.cosmetics.owned, ...next.rewards.pending], next.band, rng, seasonalDropDate(next, t));
    next = {
      ...next,
      challenges: { ...state, rewarded: true },
      rewards: c ? { ...next.rewards, pending: [...next.rewards.pending, c.id] } : next.rewards,
    };
    if (c) gifts.push(c.id);
    extras.push({ key: c ? 'year.today.gift' : 'year.today.complete' });
    appendLog(p.id, [event(EVENTS.QUEST_DONE, { ids, year, via: 'challenges' }, sid)]);
  }
  return { profile: next, gifts, extras };
}

/** After an engine session ended: tick its challenge when it ran to the end with at least one answer. */
export function settleChallenge(p: Profile, opts: SessionOptions, completed: boolean, answered: number, sid: string, t: number, rng: Rng): ChallengeSettlement {
  if (!opts.challenge || opts.year === undefined || !completed || answered === 0) return { profile: p, gifts: [], extras: [] };
  return tickChallenge(p, opts.year, opts.challenge, sid, t, rng);
}
