/**
 * Checker for a built Target answer. The UI sends the tree it built as a repr
 * string; this re-parses it and recomputes everything from the dealt cards.
 * A value the UI reports is never trusted.
 *
 * Checks, in order:
 * 1. `parse`: the repr is well-formed ASCII infix (see `parseRepr`);
 * 2. `badOp`: every operator is one the deal allows;
 * 3. `notCard` / `reusedCard`: the leaves are a sub-multiset of the cards
 *    (a value that is no card at all is `notCard`; a card used more often than
 *    it was dealt is `reusedCard`);
 * 4. `wrongValue`: the exact value equals the target (`value` is `null` when
 *    the tree divides by zero);
 * 5. `unused`: with `mustUseAll`, every card is used. This comes after the
 *    value, so it only fires for an otherwise correct answer.
 *
 * The intermediate-value rules (negatives, fractions) shape which deals and
 * solutions the solver offers; they do not make a correct answer wrong.
 */
import { eq, type Rational } from '../rational';
import { canonical, leaves, opsUsed, parseRepr, toRat, TARGET_OPS, type TExpr, type TargetOp } from './expr';

export type TargetCheckReason = 'parse' | 'badOp' | 'notCard' | 'reusedCard' | 'wrongValue' | 'unused';

export interface TargetCheckRules {
  ops: readonly TargetOp[];
  mustUseAll: boolean;
}

export interface TargetCheckResult {
  ok: boolean;
  /** Exact value of the parsed tree; `null` if it did not parse or divides by zero. */
  value: Rational | null;
  reason?: TargetCheckReason;
  /** The parsed tree (absent on `parse`). */
  expr?: TExpr;
  /** Canonical key when `ok`: two answers with equal keys are the same way. */
  canon?: string;
}

export function checkTargetRepr(
  repr: string,
  cards: ReadonlyArray<number | Rational>,
  target: number | Rational,
  rules: TargetCheckRules,
): TargetCheckResult {
  const expr = parseRepr(repr);
  if (!expr) return { ok: false, value: null, reason: 'parse' };

  const fail = (reason: TargetCheckReason, value: Rational | null = null): TargetCheckResult => ({
    ok: false,
    value,
    reason,
    expr,
  });

  if (opsUsed(expr).some((op) => !rules.ops.includes(op))) return fail('badOp');

  const pool = cards.map(toRat);
  const unused = pool.slice();
  for (const v of leaves(expr)) {
    const i = unused.findIndex((c) => eq(c, v));
    if (i < 0) return fail(pool.some((c) => eq(c, v)) ? 'reusedCard' : 'notCard');
    unused.splice(i, 1);
  }

  // Only now is the tree known to be small (at most one leaf per card), so it
  // is safe to evaluate.
  const c = canonical(expr);
  const value = c?.v ?? null;
  if (!value || !eq(value, toRat(target))) return fail('wrongValue', value);
  if (rules.mustUseAll && unused.length > 0) return fail('unused', value);
  return { ok: true, value, expr, canon: c!.key };
}

// ── Item data (for the `custom` 'target.deal' prompt) ──────────────────────

/**
 * JSON-safe deal data stored in an item's `prompt.data`: everything the board
 * and the checker need, and the reprs of the distinct solutions, simplest
 * first, for "other ways".
 */
export interface TargetDealData {
  cards: number[];
  target: number;
  ops: TargetOp[];
  mustUseAll: boolean;
  allowNegativeIntermediates: boolean;
  allowFractionIntermediates: boolean;
  /** Distinct solution reprs, simplest first. */
  ways: string[];
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);

/** Validates untrusted `prompt.data` (e.g. from a stored log); `null` if malformed. */
export function readDealData(data: unknown): TargetDealData | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const { cards, target, ops, mustUseAll, allowNegativeIntermediates, allowFractionIntermediates, ways } = d;
  if (!Array.isArray(cards) || cards.length === 0 || cards.length > 10 || !cards.every(isInt)) return null;
  if (!isInt(target)) return null;
  if (!Array.isArray(ops) || !ops.every((o) => (TARGET_OPS as readonly unknown[]).includes(o))) return null;
  if (typeof mustUseAll !== 'boolean') return null;
  if (typeof allowNegativeIntermediates !== 'boolean' || typeof allowFractionIntermediates !== 'boolean') return null;
  if (!Array.isArray(ways) || !ways.every((w) => typeof w === 'string')) return null;
  return {
    cards: cards.slice(),
    target,
    ops: TARGET_OPS.filter((o) => ops.includes(o)),
    mustUseAll,
    allowNegativeIntermediates,
    allowFractionIntermediates,
    ways: ways.slice(),
  };
}

/** Checks a built answer against deal data from an item; malformed data fails as `parse`. */
export function checkDealRepr(data: unknown, repr: string): TargetCheckResult {
  const deal = readDealData(data);
  if (!deal) return { ok: false, value: null, reason: 'parse' };
  return checkTargetRepr(repr, deal.cards, deal.target, deal);
}
