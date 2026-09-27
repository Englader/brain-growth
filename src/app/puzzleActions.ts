/**
 * Puzzle-track actions (plan §4 step 8). The puzzle mode runs no engine
 * session: it writes a session start/end record with mode 'puzzle' (so minutes,
 * session counts and "tried every mode" include it) and one `puzzle` event per
 * finished puzzle. It writes NO item records, never touches the streak and
 * never updates quests: a day of puzzles alone neither lights the daily spark
 * nor advances quests, and puzzles are never needed for progress.
 */
import { uid } from '../core/hash';
import { EVENTS, type SessionRecord } from '../core/log/types';
import type { Profile } from '../core/profile';
import { finishPuzzle, getPuzzleType, PUZZLE_TARGET, startPuzzle, type PuzzleEvent, type PuzzleOutcome, type StartedPuzzle } from '../puzzles';
import { appendLog, event, saveProfile, unlockAchievements } from './persist';
import { nextSeed, now } from './services';

export interface PuzzleSession {
  sid: string;
  pid: string;
  startedAt: number;
  /** Puzzles finished (solved or revealed) and solved in this session. */
  finished: number;
  solved: number;
}

const sessionRecord = (p: Profile, s: PuzzleSession, phase: 'start' | 'end', completed: boolean | null): SessionRecord => {
  const t = now();
  return {
    type: 'session', ts: t, sid: s.sid, phase, mode: 'puzzle', band: p.band, locale: p.locale, opts: {},
    items: phase === 'end' ? s.finished : null,
    firstCorrect: phase === 'end' ? s.solved : null,
    durationMs: phase === 'end' ? t - s.startedAt : null,
    completed,
  };
};

/** Open a puzzle session (logged when the first puzzle starts, not when the shelf opens). */
export function startPuzzleSession(p: Profile): PuzzleSession {
  const s: PuzzleSession = { sid: uid('s'), pid: p.id, startedAt: now(), finished: 0, solved: 0 };
  appendLog(p.id, [sessionRecord(p, s, 'start', null)]);
  return s;
}

/** Choose a level from the type's rating (band prior when new) and generate the puzzle. Pure apart from the seed. */
export function beginPuzzle(p: Profile, type: string, harder: boolean): StartedPuzzle<unknown> {
  const target = harder ? PUZZLE_TARGET.HARDER : PUZZLE_TARGET.NORMAL;
  return startPuzzle(getPuzzleType(type), p.band, p.puzzles?.[type], target, now(), nextSeed());
}

/**
 * A puzzle ended (solved by the child, or revealed): update its type's rating,
 * log the event, evaluate achievements. Saves and returns the profile.
 */
export function completePuzzle(
  p: Profile,
  s: PuzzleSession,
  started: StartedPuzzle<unknown>,
  outcome: PuzzleOutcome,
): { profile: Profile; session: PuzzleSession; event: PuzzleEvent; unlocked: string[] } {
  const { ratings, event: ev } = finishPuzzle(p.puzzles ?? {}, started, outcome, p.locale);
  appendLog(p.id, [event(EVENTS.PUZZLE, { ...ev }, s.sid)]);
  const a = unlockAchievements({ ...p, puzzles: ratings }, 'item', s.sid);
  const session = { ...s, finished: s.finished + 1, solved: s.solved + (outcome.solved ? 1 : 0) };
  return { profile: saveProfile(a.profile), session, event: ev, unlocked: a.ids };
}

/** Close the session: end record, session count (if any puzzle was finished), session achievements. */
export function endPuzzleSession(p: Profile, s: PuzzleSession): { profile: Profile; unlocked: string[] } {
  appendLog(p.id, [sessionRecord(p, s, 'end', s.finished > 0)]);
  const counted = s.finished > 0 ? { ...p, stats: { ...p.stats, sessions: p.stats.sessions + 1 } } : p;
  const a = unlockAchievements(counted, 'session', s.sid);
  return { profile: saveProfile(a.profile), unlocked: a.ids };
}
