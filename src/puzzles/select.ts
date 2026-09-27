/**
 * Choosing a puzzle's difficulty from the per-type rating.
 *
 * Same mapping as the engine (DESIGN §1.5): invert the prediction for the
 * target success probability to get a logit difficulty d, convert with
 * d = −2.5 + 5ℓ, add a small level jitter so consecutive puzzles differ, then
 * generate. The child picks the type freely from the shelf; the target is
 * 0.75 normally and 0.55 for the "Harder one" chip. There is no success-rate
 * controller here: puzzles are free play, not a session with a quota.
 *
 * Everything is a pure function of (rating, target, now, seed), and the
 * puzzle itself of (type, version, seed, band, requested level), so any puzzle
 * a child saw can be rebuilt from its log event.
 */
import { difficultyToLevel, glickoElo, levelToDifficulty } from '../core/engine/glicko';
import { SELECTION } from '../core/engine/params';
import { createRng } from '../core/rng';
import type { BandId } from '../core/types';
import { asSkillState, initPuzzleRating, predictPuzzle, puzzlePrior, type PuzzleRating } from './rating';
import type { PuzzleTypeDef } from './types';
import { clamp01 } from './util';

export const PUZZLE_TARGET = {
  NORMAL: 0.75,
  /** The "Harder one" chip (drives "Above My Level"). */
  HARDER: 0.55,
} as const;

/** Salt for the jitter stream, so it is independent of the generator's stream. */
const JITTER_SALT = 0x2545f491;

/** Requested level for success probability `p` (before jitter). An unseen type uses its band's prior. */
export function puzzleLevelFor(rating: PuzzleRating | undefined, p: number, now: number, band: BandId = 'A'): number {
  const r = rating ?? initPuzzleRating(now, puzzlePrior(band));
  return clamp01(difficultyToLevel(glickoElo.difficultyFor(asSkillState(r), p, now)));
}

/** Deterministic level jitter for a seed: N(0, SELECTION.JITTER). */
export function levelJitter(seed: number): number {
  return createRng(seed ^ JITTER_SALT).normal() * SELECTION.JITTER;
}

export interface StartedPuzzle<P> {
  type: string;
  /** Type version (logged as `v`). */
  v: number;
  seed: number;
  band: BandId;
  /** Target success probability asked for (0.75 or 0.55). */
  target: number;
  /** Requested level after jitter: `generate(createRng(seed), band, req)` rebuilds the puzzle. */
  req: number;
  /** Achieved level and its logit difficulty. */
  level: number;
  diff: number;
  /** Predicted P(solved without help) at the achieved difficulty, before the outcome. */
  p: number;
  /** When the puzzle was shown (ms); the rating update uses this time. */
  ts: number;
  puzzle: P;
  features: Record<string, number>;
}

export function startPuzzle<P, A>(
  def: PuzzleTypeDef<P, A>,
  band: BandId,
  rating: PuzzleRating | undefined,
  target: number,
  now: number,
  seed: number,
): StartedPuzzle<P> {
  const req = clamp01(puzzleLevelFor(rating, target, now, band) + levelJitter(seed));
  const g = def.generate(createRng(seed), band, req);
  return {
    type: def.id,
    v: def.version,
    seed,
    band,
    target,
    req,
    level: g.achievedLevel,
    diff: levelToDifficulty(g.achievedLevel),
    p: predictPuzzle(rating ?? initPuzzleRating(now, puzzlePrior(band)), g.achievedLevel, now),
    ts: now,
    puzzle: g.puzzle,
    features: g.features,
  };
}

/** Rebuild the exact puzzle from its logged provenance (same type version required). */
export function rebuildPuzzle<P, A>(def: PuzzleTypeDef<P, A>, band: BandId, seed: number, req: number): P {
  return def.generate(createRng(seed), band, req).puzzle;
}
