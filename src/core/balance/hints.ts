/**
 * Hint tiers for a Balance item, built from the shortest path from the
 * CURRENT scale (so a child who has already made moves gets a hint for where
 * they are, not for where they started). Language-neutral data only.
 *
 * - Tier 1 names the kind of the next move: gather the x-boxes ('x'), clear
 *   the weights next to them ('k'), or split into equal groups ('div').
 * - Tier 2 gives the next move exactly.
 * - Tier 3 gives the next two moves; when only two remain it gives the next
 *   move and the kind of the one after, and a one-move path has no tier 3.
 *
 * No tier carries a resulting scale or the value of x: the child still makes
 * the moves and reads x off the scale. Scoring (0.25 per tier used, or 0 for
 * reveal) is the mode's; `balanceY` covers blocked moves.
 */
import { moveKind, solutionPath, type BalanceMove, type BalanceState, type MoveKind } from './moves';

export type BalanceHint =
  | { tier: 1; kind: MoveKind }
  | { tier: 2; move: BalanceMove }
  | { tier: 3; moves: BalanceMove[]; nextKind?: MoveKind };

/** All hint tiers for this state, tier 1 first; empty when x is already alone or no path exists. */
export function balanceHints(state: BalanceState): BalanceHint[] {
  const path = solutionPath(state.eq, state.balloons);
  if (!path || path.length === 0) return [];
  const first = path[0]!;
  const hints: BalanceHint[] = [
    { tier: 1, kind: moveKind(first) },
    { tier: 2, move: first },
  ];
  if (path.length === 2) hints.push({ tier: 3, moves: [first], nextKind: moveKind(path[1]!) });
  else if (path.length >= 3) hints.push({ tier: 3, moves: path.slice(0, 2) });
  return hints;
}

/** One tier, or `null` when this state has no such tier. */
export function balanceHint(state: BalanceState, tier: 1 | 2 | 3): BalanceHint | null {
  return balanceHints(state).find((h) => h.tier === tier) ?? null;
}
