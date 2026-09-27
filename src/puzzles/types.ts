/**
 * The puzzle track's contract (DESIGN §1.4, plan §4 step 8).
 *
 * A puzzle type is a pure, seeded generator plus a checker, a solver and a
 * hint ladder. Everything here is LANGUAGE-NEUTRAL structured data: puzzles
 * hold numbers and abstract ids (tile ids, shape ids, symbol ids), never text.
 * The presentation layer renders them with the active locale and resolves the
 * message keys that hints carry.
 *
 * Difficulty follows the engine's convention (DESIGN §1.5): a level ℓ ∈ [0,1]
 * on a per-type scale, produced by a hand-built scorer over logged features
 * (so it can be re-fitted from data later), mapped to logits by d = −2.5 + 5ℓ.
 * The level scale is shared by every band a type supports; the band only
 * decides which rule families and number ranges are available and how the
 * puzzle is drawn (pictures in Band A). One rating per type therefore stays
 * meaningful when a child changes band.
 */
import type { Rng } from '../core/rng';
import type { BandId } from '../core/types';

export type PuzzleTypeId = string;

export interface GeneratedPuzzle<P> {
  puzzle: P;
  /** Achieved difficulty on the type's [0,1] scale (may differ from the requested level). */
  achievedLevel: number;
  /** Raw difficulty factors, logged so the scorer can be re-fitted from data. */
  features: Record<string, number>;
}

/**
 * Result of a check. `violated` names the constraints the answer breaks, so the
 * UI can highlight them gently ("not yet"). Ids are per-type and documented on
 * each type; they follow `kind` or `kind:detail` (e.g. `scale:1`, `col:0`,
 * `distinct:s3`). Present and non-empty exactly when `ok` is false.
 */
export interface CheckResult {
  ok: boolean;
  violated?: string[];
}

/**
 * One rung of a hint ladder. `key` is a message key (resolved by the UI in the
 * active locale; Band A plays it as a voice line or shows nothing but the
 * highlight). `params` are numbers or ids, never text. `focus` lists element
 * ids to highlight, in the same id scheme as `CheckResult.violated` plus
 * type-specific element ids (`pos:3`, `shape:s1`, `sym:s4`, …).
 */
export interface PuzzleHint {
  key: string;
  params: Record<string, number | string>;
  focus: string[];
}

export interface PuzzleTypeDef<P, A> {
  id: PuzzleTypeId;
  /** Bump when output for a given (seed, band, level) changes. Logged per puzzle. */
  version: number;
  /** Bands this type is offered in. `generate` throws for any other band. */
  bands: readonly BandId[];
  generate(rng: Rng, band: BandId, level: number): GeneratedPuzzle<P>;
  /** Accepts ANY answer that satisfies every constraint, not only the stored solution. */
  check(puzzle: P, answer: A): CheckResult;
  /** At least one solution; every returned solution passes `check`. */
  solve(puzzle: P): A[];
  /** Hint for tier 1, 2, …; null when the ladder has no rung at that tier. */
  hint(puzzle: P, tier: number): PuzzleHint | null;
}

/** A registered type of any puzzle/answer shape (the registry is heterogeneous). */
export type AnyPuzzleType = PuzzleTypeDef<any, any>;

export const ok = (): CheckResult => ({ ok: true });
export const fail = (violated: string[]): CheckResult =>
  violated.length > 0 ? { ok: false, violated } : { ok: false, violated: ['answer'] };
