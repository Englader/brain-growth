/**
 * Hint tiers for a Target deal, built from its best (simplest) solution.
 * Language-neutral data only; the UI and i18n layer turn it into words,
 * highlighted cards or a hop.
 *
 * - Tier 1 names one operator of the solution (the least obvious one:
 *   ÷ before × before − before +).
 * - Tier 2 gives the first step, `a op b = r`.
 * - Tier 3 gives the first two steps.
 *
 * No tier gives the whole solution: when the solution is too short for a tier,
 * the tier shows its next step only partly (`next`: the left operand and the
 * operator, not the other operand or the result), and a one-step solution has
 * no tier 3. Scoring (1 − 0.25 per tier) is the caller's.
 */
import type { Rational } from '../rational';
import { applyOp, type TExpr, type TargetOp } from './expr';

export interface TargetStep {
  a: Rational;
  op: TargetOp;
  b: Rational;
  r: Rational;
}

export type TargetHint =
  | { tier: 1; op: TargetOp }
  | {
      tier: 2 | 3;
      /** Complete steps, in the order to do them. */
      steps: TargetStep[];
      /** The following step, partly: its left operand and operator. */
      next?: { a: Rational; op: TargetOp };
    };

/**
 * The merges that build `e`, in post-order (left subtree, right subtree, then
 * the node): each is one tap-op-tap on the board. Throws on a tree that cannot
 * be evaluated, which a solver solution never is.
 */
export function solutionSteps(e: TExpr): TargetStep[] {
  const steps: TargetStep[] = [];
  const walk = (x: TExpr): Rational => {
    if (x.k === 'n') return x.v;
    const a = walk(x.a);
    const b = walk(x.b);
    const r = applyOp(x.op, a, b);
    if (!r) throw new RangeError('solutionSteps: expression cannot be evaluated');
    steps.push({ a, op: x.op, b, r });
    return r;
  };
  walk(e);
  return steps;
}

const OP_RANK: Record<TargetOp, number> = { '+': 0, '-': 1, '*': 2, '/': 3 };

/** Hint tiers available for this solution, tier 1 first (empty for a bare card). */
export function targetHints(best: TExpr): TargetHint[] {
  const steps = solutionSteps(best);
  if (steps.length === 0) return [];
  const op = steps.reduce((m, s) => (OP_RANK[s.op] > OP_RANK[m] ? s.op : m), steps[0]!.op);
  const partial = (s: TargetStep): { a: Rational; op: TargetOp } => ({ a: s.a, op: s.op });
  const hints: TargetHint[] = [{ tier: 1, op }];
  if (steps.length === 1) {
    hints.push({ tier: 2, steps: [], next: partial(steps[0]!) });
    return hints;
  }
  hints.push({ tier: 2, steps: steps.slice(0, 1) });
  hints.push(
    steps.length === 2
      ? { tier: 3, steps: steps.slice(0, 1), next: partial(steps[1]!) }
      : { tier: 3, steps: steps.slice(0, 2) },
  );
  return hints;
}

/** One tier, or `null` when this solution has no such tier. */
export function targetHint(best: TExpr, tier: 1 | 2 | 3): TargetHint | null {
  return targetHints(best).find((h) => h.tier === tier) ?? null;
}
