/**
 * One notion of "help" for every answer in the log, for the grown-ups' Help
 * view (src/adult/Help.tsx) and the pilot readout. Pure and read-only: it
 * never changes credit. The engine keeps crediting a correct answer
 * 1 − 0.25·tier (engine/observe.hintTierOf) and a "show me" as wrong.
 *
 *   none    answered without a hint and without "show me"
 *   hint1…3 the highest hint-ladder tier opened before answering (§1.11):
 *           1 strategy, 2 first hop or move, 3 first worked step or moves;
 *           a puzzle's third hint and beyond count as hint3
 *   shown   the child asked to be shown the answer ("show me"), whatever
 *           hints came before; a puzzle revealed, or finished together
 *
 * Current records say it directly (`revealed`, and `ladder` where the credit
 * tier also counts something else). Older records are read from what they
 * logged, and only for the modes that had "show me":
 *   - Target and the Workshop graded a reveal as the answer 'reveal';
 *   - Balance logged the move transcript, ending '=?' when shown, and its
 *     credit tier is min(3, hint tier + refused one-pan moves): the refused
 *     moves are read back from the transcript (a `!` move aimed at one pan).
 */
import { applyMove, eqn, isBlocked, parseTranscript, startState } from '../balance';
import { hintTierOf } from '../engine/observe';
import type { ItemRecord } from './types';

export type Help = 'none' | 'hint1' | 'hint2' | 'hint3' | 'shown';

/** Every kind of help, from none to the most. */
export const HELP_KINDS: readonly Help[] = ['none', 'hint1', 'hint2', 'hint3', 'shown'];

const BALANCE_MODE = 'balance';
/** Any scale: a one-pan move is refused as `unbalanced` before the scale is looked at. */
const ANY_SCALE = startState(eqn(1, 0, 0, 1), true);

/** Refused one-pan moves in a Balance transcript: the ones its credit tier charges. */
export function refusedOnePanMoves(transcript: string): number {
  const t = parseTranscript(transcript);
  if (!t) return 0;
  let n = 0;
  for (const e of t.entries) {
    if (e.kind !== 'move' || !e.claimedBlocked) continue;
    const r = applyMove(ANY_SCALE, e.move);
    if (isBlocked(r) && r.blocked === 'unbalanced') n++;
  }
  return n;
}

/** Whether the child asked to be shown the answer on this attempt. */
export function wasRevealed(r: ItemRecord): boolean {
  if (typeof r.revealed === 'boolean') return r.revealed;
  // Older records (before `revealed`): what a reveal was graded as.
  if (r.correct) return false;
  if (r.answer === 'reveal') return true;
  return r.mode === BALANCE_MODE && /(^|;)=\?$/.test(r.answer);
}

/** Highest hint-ladder tier opened before this answer (0–3). */
export function ladderTierOf(r: ItemRecord): number {
  if (typeof r.ladder === 'number' && Number.isFinite(r.ladder)) return Math.max(0, Math.min(3, Math.round(r.ladder)));
  const credit = hintTierOf(r.hint, r.tier);
  // An older Balance record: its credit tier also counted refused one-pan moves.
  if (r.mode === BALANCE_MODE && credit > 0) return Math.max(0, credit - refusedOnePanMoves(r.answer));
  return credit;
}

const byTier = (tier: number): Help => (tier <= 0 ? 'none' : tier === 1 ? 'hint1' : tier === 2 ? 'hint2' : 'hint3');

/** The help behind one answer (any mode's item record, old or new). */
export function helpOf(r: ItemRecord): Help {
  return wasRevealed(r) ? 'shown' : byTier(ladderTierOf(r));
}

/** The facts of a `puzzle` event that say how it was finished (src/puzzles/replay.ts, PuzzleEvent). */
export interface PuzzleHelpFacts {
  /** Solved by the child's own answer; false when revealed, or finished together after every hint (Band A). */
  solved: boolean;
  /** Hint rungs used. */
  hints: number;
}

/** The help behind a finished puzzle: shown unless the child solved it, else by the hints used. */
export function puzzleHelpOf(e: PuzzleHelpFacts): Help {
  if (!e.solved) return 'shown';
  return byTier(Number.isFinite(e.hints) ? Math.floor(e.hints) : 0);
}

/** Any help at all. */
export const helped = (h: Help): boolean => h !== 'none';
