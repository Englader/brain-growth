/**
 * Choice policy and simulation, used to tune lane lengths (fairness) and by
 * the tests. Not used for real children: a real Band B child chooses.
 *
 * Greedy policy (the assumed Band B player): take the option whose FINAL
 * square (after any ladder) is furthest along; on a tie, the earlier operator
 * in + − × order. A and C always have exactly one option.
 */
import { fnv1a } from '../hash';
import { createRng, type Rng } from '../rng';
import type { BandId } from '../types';
import { boardFor } from './board';
import { applyMove, isFinished, moveOptions, newLane, roll } from './rules';
import type { Board, DiceOp, MoveOption } from './types';

export type Policy = (options: readonly MoveOption[]) => MoveOption;

export const greedyPolicy: Policy = (options) => {
  let best = options[0];
  if (!best) throw new Error('no move options');
  for (const o of options) if (o.target > best.target) best = o;
  return best;
};

/** Turns one lane takes to finish, playing `policy`. */
export function simulateLane(board: Board, ops: readonly DiceOp[], rng: Rng, policy: Policy = greedyPolicy, maxTurns = 500): number {
  let lane = newLane(board);
  while (!isFinished(lane)) {
    if (lane.turns >= maxTurns) return maxTurns;
    const opts = moveOptions(board, lane.position, roll(rng, board.band), ops);
    lane = applyMove(lane, policy(opts)).lane;
  }
  return lane.turns;
}

export interface TurnStats {
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  max: number;
}

/**
 * Monte Carlo expected turns for a band (and, for B, an operator set), over
 * `n` lanes on `n` different boards. Deterministic for a given seed.
 */
export function expectedTurns(band: BandId, ops: readonly DiceOp[], n: number, seed = 1): TurnStats {
  const rng = createRng(fnv1a(`dice.sim|${band}|${ops.join('')}|${seed}`));
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(simulateLane(boardFor(band, seed * 100_003 + i, ops), ops, rng));
  xs.sort((a, b) => a - b);
  const q = (p: number): number => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
  return { mean: xs.reduce((s, x) => s + x, 0) / xs.length, p10: q(0.1), p50: q(0.5), p90: q(0.9), max: xs[xs.length - 1]! };
}
