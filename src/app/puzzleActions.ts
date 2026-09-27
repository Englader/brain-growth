/**
 * Puzzle-track actions (plan §4 step 8). The puzzle mode runs no engine
 * session: it writes a session start/end record with mode 'puzzle' (so minutes,
 * session counts and "tried every mode" include it) and one `puzzle` event per
 * finished puzzle. It writes NO item records, never touches the streak and
 * never updates quests: a day of puzzles alone neither lights the daily spark
 * nor advances quests, and puzzles are never needed for progress. A puzzle
 * opened for today's puzzle challenge ticks it when solved (DESIGN A-29).
 */
import { uid } from '../core/hash';
import { EVENTS, type SessionOptions, type SessionRecord } from '../core/log/types';
import type { Profile } from '../core/profile';
import { createRng } from '../core/rng';
import { ownYear, puzzleLevelShift } from '../core/years';
import { finishPuzzle, getPuzzleType, PUZZLE_TARGET, startPuzzle, type PuzzleEvent, type PuzzleOutcome, type StartedPuzzle } from '../puzzles';
import { appendLog, event, saveProfile, unlockAchievements } from './persist';
import { nextSeed, now } from './services';
import { tickChallenge } from './yearActions';

export interface PuzzleSession {
  sid: string;
  pid: string;
  startedAt: number;
  /** School year the shelf follows (DESIGN A-29) and the challenge it was opened for, if any. */
  opts: SessionOptions;
  /** Puzzles finished (solved or revealed) and solved in this session. */
  finished: number;
  solved: number;
}

const sessionRecord = (p: Profile, s: PuzzleSession, phase: 'start' | 'end', completed: boolean | null): SessionRecord => {
  const t = now();
  return {
    type: 'session', ts: t, sid: s.sid, phase, mode: 'puzzle', band: p.band, locale: p.locale, opts: s.opts,
    items: phase === 'end' ? s.finished : null,
    firstCorrect: phase === 'end' ? s.solved : null,
    durationMs: phase === 'end' ? t - s.startedAt : null,
    completed,
    lastCorrect: null,
    exitIndex: null,
    year: s.opts.year ?? null,
  };
};

/** Open a puzzle session (logged when the first puzzle starts, not when the shelf opens). */
export function startPuzzleSession(p: Profile, opts: SessionOptions = {}): PuzzleSession {
  const s: PuzzleSession = { sid: uid('s'), pid: p.id, startedAt: now(), opts, finished: 0, solved: 0 };
  appendLog(p.id, [sessionRecord(p, s, 'start', null)]);
  return s;
}

/**
 * Choose a level from the type's rating (band prior when new) and generate the puzzle. Pure apart from the seed.
 * For a school year above or below the child's own the level moves by puzzleLevelShift (DESIGN A-29); the
 * puzzle is always drawn in the child's own band.
 */
export function beginPuzzle(p: Profile, type: string, harder: boolean, year?: number): StartedPuzzle<unknown> {
  const target = harder ? PUZZLE_TARGET.HARDER : PUZZLE_TARGET.NORMAL;
  const shift = year === undefined ? 0 : puzzleLevelShift(year, ownYear(p.age));
  const started = startPuzzle(getPuzzleType(type), p.band, p.puzzles?.[type], target, now(), nextSeed(), shift);
  return year === undefined ? started : { ...started, year };
}

/**
 * A puzzle ended (solved by the child, or revealed): update its type's rating,
 * log the event, evaluate achievements. Saves and returns the profile.
 *
 * Opened for today's puzzle challenge (DESIGN A-29), a puzzle of that type
 * ticks it once it is solved, hints and checks allowed; in Band A, where
 * nothing fails, finishing it together with the glowing answer counts too.
 * The day's first complete set adds a gift to `pending` (returned in `gifts`).
 */
export function completePuzzle(
  p: Profile,
  s: PuzzleSession,
  started: StartedPuzzle<unknown>,
  outcome: PuzzleOutcome,
): { profile: Profile; session: PuzzleSession; event: PuzzleEvent; unlocked: string[]; gifts: string[] } {
  const { ratings, event: ev } = finishPuzzle(p.puzzles ?? {}, started, outcome, p.locale);
  appendLog(p.id, [event(EVENTS.PUZZLE, { ...ev }, s.sid)]);
  const a = unlockAchievements({ ...p, puzzles: ratings }, 'item', s.sid);
  const session = { ...s, finished: s.finished + 1, solved: s.solved + (outcome.solved ? 1 : 0) };
  let next = a.profile;
  let gifts: string[] = [];
  const { year, challenge } = s.opts;
  if (year !== undefined && challenge === `puzzle.${started.type}` && (outcome.solved || started.band === 'A')) {
    const r = tickChallenge(next, year, challenge, s.sid, now(), createRng(nextSeed()));
    next = r.profile;
    gifts = r.gifts;
  }
  return { profile: saveProfile(next), session, event: ev, unlocked: a.ids, gifts };
}

/** Close the session: end record, session count (if any puzzle was finished), session achievements. */
export function endPuzzleSession(p: Profile, s: PuzzleSession): { profile: Profile; unlocked: string[] } {
  appendLog(p.id, [sessionRecord(p, s, 'end', s.finished > 0)]);
  const counted = s.finished > 0 ? { ...p, stats: { ...p.stats, sessions: p.stats.sessions + 1 } } : p;
  const a = unlockAchievements(counted, 'session', s.sid);
  return { profile: saveProfile(a.profile), unlocked: a.ids };
}
