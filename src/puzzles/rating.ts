/**
 * Per-puzzle-type rating (plan §4 step 8): `profile.puzzles[type]`.
 *
 * The maths is the engine's Glicko-Elo model, unchanged (DESIGN §1.5,
 * src/core/engine/glicko.ts): a rating is projected onto a SkillState and
 * passed to `glickoElo.update` / `predict` / `difficultyFor`, which depend only
 * on the state (no SkillDef). The projection has no spaced-retrieval memory
 * (R = 1, so no forgetting penalty) and status 'learning' (so the AFM learning
 * drift applies to every puzzle, as for any non-mastered skill).
 *
 * Puzzle ratings are NEVER stored in `profile.skills`: analytics look every
 * skill id up in the graph, and a puzzle type is not a skill.
 *
 * Outcome (no timers; latency never matters):
 *   y = solved ? max(0, 1 − 0.25·hints − 0.1·min(3, wrongChecks)) : 0
 * A reveal (or giving up) is y = 0 and does not count as solved.
 */
import { glickoElo, levelToDifficulty } from '../core/engine/glicko';
import type { SkillState } from '../core/engine/model';
import { MODEL } from '../core/engine/params';
import type { BandId } from '../core/types';

export interface PuzzleRating {
  /** Ability mean on the logit scale of the type's difficulty (d = −2.5 + 5ℓ). */
  mu: number;
  /** Ability variance. */
  s2: number;
  /** Rated puzzles (solved or revealed). */
  n: number;
  /** Time of the last rated puzzle (ms). Variance grows with days away. */
  lastSeen: number;
  /** Puzzles solved (not revealed). */
  solved: number;
}

export type PuzzleRatings = Record<string, PuzzleRating>;

export const PUZZLE_SCORE = {
  HINT_COST: 0.25,
  WRONG_CHECK_COST: 0.1,
  /** Wrong checks beyond this cost nothing more: checking is always allowed. */
  WRONG_CHECK_CAP: 3,
} as const;

export interface PuzzleOutcome {
  /** True only when the child's own answer passed the check; false for a reveal. */
  solved: boolean;
  /** Hint rungs used. */
  hints: number;
  /** Checks that failed ("not yet"). */
  wrongChecks: number;
  /** Time spent. Accepted and ignored: latency never affects the rating. */
  ms?: number;
  /** Violated-constraint ids of each failed check, joined by '+' (logged precisely, e.g. "below"). */
  fails?: string[];
}

const count = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0);

export function puzzleY(o: PuzzleOutcome): number {
  if (!o.solved) return 0;
  const y =
    1 -
    PUZZLE_SCORE.HINT_COST * count(o.hints) -
    PUZZLE_SCORE.WRONG_CHECK_COST * Math.min(PUZZLE_SCORE.WRONG_CHECK_CAP, count(o.wrongChecks));
  // Round away float noise (1 − 0.1·3 = 0.7000000000000001) so logged y is clean.
  return Math.max(0, Math.round(y * 1e9) / 1e9);
}

export interface PuzzlePrior {
  mu: number;
  s2: number;
}

/**
 * Starting belief for a type the child has never played, by band. Band A uses
 * the engine's practice prior N(−0.5, 1.5); B starts at μ = 0 and C at μ = 0.5
 * so older children do not open on trivial puzzles (first level ≈ 0.12 / 0.22 /
 * 0.32 at p = 0.75). The prior is chosen by the band of the FIRST puzzle of a
 * type (logged on its event), so replay reproduces it.
 */
export const PUZZLE_PRIORS: Readonly<Record<BandId, PuzzlePrior>> = {
  A: { mu: MODEL.PRIOR_MU, s2: MODEL.PRIOR_S2 },
  B: { mu: 0, s2: MODEL.PRIOR_S2 },
  C: { mu: 0.5, s2: MODEL.PRIOR_S2 },
};

export const puzzlePrior = (band: BandId): PuzzlePrior => PUZZLE_PRIORS[band] ?? PUZZLE_PRIORS.A;

/** A fresh rating (default: the engine's practice prior N(−0.5, 1.5)). */
export function initPuzzleRating(now: number, prior?: PuzzlePrior): PuzzleRating {
  return { mu: prior?.mu ?? MODEL.PRIOR_MU, s2: prior?.s2 ?? MODEL.PRIOR_S2, n: 0, lastSeen: now, solved: 0 };
}

/** The rating as the engine's SkillState: no memory block (R = 1), still learning. */
export function asSkillState(r: PuzzleRating): SkillState {
  return {
    mu: r.mu,
    s2: r.s2,
    n: r.n,
    correct: r.solved,
    recent: 0,
    recentN: 0,
    lastSeen: r.lastSeen,
    status: 'learning',
    origin: 'practice',
  };
}

/** P(solved without help) for a puzzle of `level`, integrating uncertainty (engine prediction). */
export function predictPuzzle(r: PuzzleRating, level: number, now: number): number {
  return glickoElo.predict(asSkillState(r), levelToDifficulty(level), now);
}

export interface PuzzleObservation {
  /** Outcome in [0, 1] (see puzzleY). */
  y: number;
  /** Logit difficulty of the puzzle actually shown: levelToDifficulty(achievedLevel). */
  diff: number;
  /** When the puzzle was SHOWN (ms). Using the start keeps thinking time out of the update. */
  ts: number;
  solved: boolean;
}

export function updatePuzzleRating(r: PuzzleRating, obs: PuzzleObservation): PuzzleRating {
  const y = Math.min(1, Math.max(0, obs.y));
  const st = glickoElo.update(asSkillState(r), { y, difficulty: obs.diff, ts: obs.ts, weight: 1 });
  return { mu: st.mu, s2: st.s2, n: st.n, lastSeen: st.lastSeen, solved: r.solved + (obs.solved ? 1 : 0) };
}

/**
 * The single state transition, shared by live play and by replay so the two
 * can never drift apart. Only `type`'s rating changes.
 */
export function applyPuzzleResult(ratings: PuzzleRatings, type: string, obs: PuzzleObservation, prior?: PuzzlePrior): PuzzleRatings {
  const current = ratings[type] ?? initPuzzleRating(obs.ts, prior);
  return { ...ratings, [type]: updatePuzzleRating(current, obs) };
}
