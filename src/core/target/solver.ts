/**
 * Exact solver for Target deals: every distinct way to make `target` from the
 * cards, simplest first.
 *
 * General path: dynamic programming over card subsets. For each subset it
 * keeps one representative per canonical form (see `canonical` in expr.ts), so
 * rearrangements are pruned as early as possible; because the canonical form
 * is compositional, keeping one representative loses no solution. For the
 * whole deal it only canonicalises combinations that hit the target. A 4-card
 * solve with all four operators takes a few milliseconds; 5 cards stay well
 * under a second. Up to 6 cards are accepted.
 *
 * Fast path (Band A "make 10", and any +/− deal of non-negative integer
 * cards): a subset-sum search over signed card choices, 3^n assignments, which
 * is exact because every +/− expression is canonically a signed multiset of
 * cards.
 */
import { cmp, eq, isInteger, key, type Rational } from '../rational';
import {
  applyOp,
  canonCombine,
  canonLeaf,
  canonical,
  leaf,
  needsBrackets,
  node,
  toRat,
  toRepr,
  type Canon,
  type TExpr,
  type TargetOp,
  TARGET_OPS,
} from './expr';

export interface SolveOptions {
  /** Operators the child may use. Default: all four. */
  ops?: readonly TargetOp[];
  /** Whether an intermediate (or the final) value may be below zero. Default false. */
  allowNegativeIntermediates?: boolean;
  /** Whether an intermediate (or the final) value may be a non-integer. Default false. */
  allowFractionIntermediates?: boolean;
  /** Whether a solution must use every card. Default false. */
  mustUseAll?: boolean;
  /** Cap on returned solutions (the total is still counted). Default 100. */
  maxSolutions?: number;
}

export interface Solution {
  expr: TExpr;
  /** `toRepr(expr)`, e.g. `(6/(1-(3/4)))`. */
  repr: string;
  /** Canonical key; equal for rearrangements of the same solution. */
  canon: string;
  /** Number of operations (cards used − 1). */
  ops: number;
  cardsUsed: number;
  /** Distinct operators used, in + − × ÷ order. */
  opKinds: TargetOp[];
  /** Some intermediate value is not an integer. */
  usesFraction: boolean;
  /** Some intermediate value, or some card used, is negative. */
  usesNegative: boolean;
  /** Ordering score: lower is simpler. */
  complexity: number;
}

export interface SolveResult {
  /** Distinct solutions, simplest first, at most `maxSolutions`. */
  solutions: Solution[];
  /** Number of distinct solutions before the cap. */
  total: number;
  /** Of those, how many have only integer intermediates. */
  withoutFraction: number;
  /** Of those, how many use no negative card and no negative intermediate. */
  withoutNegative: number;
}

/** Largest deal the general solver accepts. */
export const MAX_GENERAL_CARDS = 6;
/** Largest deal the additive fast path accepts. */
export const MAX_ADDITIVE_CARDS = 10;

interface Rules {
  ops: readonly TargetOp[];
  neg: boolean;
  frac: boolean;
  all: boolean;
  max: number;
}

function rulesOf(o: SolveOptions): Rules {
  const ops = TARGET_OPS.filter((op) => (o.ops ?? TARGET_OPS).includes(op));
  return {
    ops,
    neg: o.allowNegativeIntermediates ?? false,
    frac: o.allowFractionIntermediates ?? false,
    all: o.mustUseAll ?? false,
    max: o.maxSolutions ?? 100,
  };
}

// ── Complexity: one formula for the DP and for whole trees ─────────────────

const OP_WEIGHT: Record<TargetOp, number> = { '+': 1, '-': 1.3, '*': 1.6, '/': 2.2 };
const OP_BIT: Record<TargetOp, number> = { '+': 1, '-': 2, '*': 4, '/': 8 };

interface Stats {
  v: Rational;
  cx: number;
  ops: number;
  cards: number;
  opMask: number;
  frac: boolean;
  neg: boolean;
}

function leafStats(v: Rational): Stats {
  return { v, cx: 0, ops: 0, cards: 1, opMask: 0, frac: false, neg: v.n < 0 };
}

/**
 * Stats of `a op b` with value `r`. The score rewards few and easy operations
 * (+ < − < × < ÷), integer and non-negative intermediates, few brackets and
 * small numbers, which is roughly the order in which a child would find them.
 */
function combineStats(op: TargetOp, e: TExpr & { k: 'op' }, a: Stats, b: Stats, r: Rational): Stats {
  const frac = !isInteger(r);
  const neg = r.n < 0;
  const brackets = (needsBrackets(op, e.a, 'a') ? 1 : 0) + (needsBrackets(op, e.b, 'b') ? 1 : 0);
  const size = Math.min(1, Math.abs(r.n / r.d) / 100);
  return {
    v: r,
    cx: a.cx + b.cx + OP_WEIGHT[op] + (frac ? 3 : 0) + (neg ? 2 : 0) + 0.4 * brackets + 0.5 * size,
    ops: a.ops + b.ops + 1,
    cards: a.cards + b.cards,
    opMask: a.opMask | b.opMask | OP_BIT[op],
    frac: a.frac || b.frac || frac,
    neg: a.neg || b.neg || neg,
  };
}

/** Stats of a whole tree (null if it cannot be evaluated). */
function treeStats(e: TExpr): Stats | null {
  if (e.k === 'n') return leafStats(e.v);
  const a = treeStats(e.a);
  const b = a && treeStats(e.b);
  if (!a || !b) return null;
  const r = applyOp(e.op, a.v, b.v);
  return r ? combineStats(e.op, e, a, b, r) : null;
}

/** Ordering score of any tree (lower is simpler); `Infinity` if it cannot be evaluated. */
export function complexity(e: TExpr): number {
  return treeStats(e)?.cx ?? Infinity;
}

// ── Shared result assembly ─────────────────────────────────────────────────

interface Found {
  e: TExpr;
  s: Stats;
  canon: string;
  repr: string;
}

function better(x: Found, y: Found): boolean {
  if (x.s.cx !== y.s.cx) return x.s.cx < y.s.cx;
  if (x.s.ops !== y.s.ops) return x.s.ops < y.s.ops;
  return x.repr < y.repr;
}

function keep(found: Map<string, Found>, f: Found): void {
  const old = found.get(f.canon);
  if (!old || better(f, old)) found.set(f.canon, f);
}

function finish(found: Map<string, Found>, max: number): SolveResult {
  const all = [...found.values()].sort((x, y) => (better(x, y) ? -1 : better(y, x) ? 1 : 0));
  const solutions = all.slice(0, Math.max(0, max)).map(
    (f): Solution => ({
      expr: f.e,
      repr: f.repr,
      canon: f.canon,
      ops: f.s.ops,
      cardsUsed: f.s.cards,
      opKinds: TARGET_OPS.filter((op) => f.s.opMask & OP_BIT[op]),
      usesFraction: f.s.frac,
      usesNegative: f.s.neg,
      complexity: f.s.cx,
    }),
  );
  return {
    solutions,
    total: all.length,
    withoutFraction: all.filter((f) => !f.s.frac).length,
    withoutNegative: all.filter((f) => !f.s.neg).length,
  };
}

function allowed(r: Rational | null, rules: Rules): r is Rational {
  return r !== null && (rules.frac || isInteger(r)) && (rules.neg || r.n >= 0);
}

// ── Additive fast path ─────────────────────────────────────────────────────

function additiveEligible(cards: readonly Rational[], target: Rational, rules: Rules): boolean {
  return (
    rules.ops.includes('+') &&
    rules.ops.every((op) => op === '+' || op === '-') &&
    cards.length <= MAX_ADDITIVE_CARDS &&
    cards.every((c) => c.n >= 0 && isInteger(c)) &&
    target.n >= 0 &&
    isInteger(target)
  );
}

/**
 * Every +/− expression over non-negative cards is canonically a signed choice
 * per card (unused, added, subtracted) with at least one card added; ordered
 * "added cards, largest first, then subtracted cards" no intermediate drops
 * below the (non-negative) target, so the search is complete whether or not
 * negative intermediates are allowed.
 */
function solveAdditive(cards: readonly Rational[], target: Rational, rules: Rules): SolveResult {
  const n = cards.length;
  const choices = rules.ops.includes('-') ? (rules.all ? [1, -1] : [0, 1, -1]) : rules.all ? [1] : [0, 1];
  const found = new Map<string, Found>();
  const sign = new Array<number>(n).fill(0);
  const byValueDesc = (x: Rational, y: Rational): number => cmp(y, x);

  const visit = (i: number, sum: Rational | null): void => {
    if (!sum) return;
    if (i < n) {
      for (const sg of choices) {
        sign[i] = sg;
        visit(i + 1, sg === 0 ? sum : applyOp(sg > 0 ? '+' : '-', sum, cards[i]!));
      }
      sign[i] = 0;
      return;
    }
    if (!eq(sum, target)) return;
    const pos: Rational[] = [];
    const neg: Rational[] = [];
    for (let j = 0; j < n; j++) {
      if (sign[j] === 1) pos.push(cards[j]!);
      else if (sign[j] === -1) neg.push(cards[j]!);
    }
    if (pos.length === 0) return;
    pos.sort(byValueDesc);
    neg.sort(byValueDesc);
    let e: TExpr = leaf(pos[0]!);
    for (const v of pos.slice(1)) e = node('+', e, leaf(v));
    for (const v of neg) e = node('-', e, leaf(v));
    const s = treeStats(e);
    const c = canonical(e);
    if (s && c) keep(found, { e, s, canon: c.key, repr: toRepr(e) });
  };
  visit(0, toRat(0));
  return finish(found, rules.max);
}

// ── General subset DP ──────────────────────────────────────────────────────

interface Entry {
  e: TExpr;
  s: Stats;
  c: Canon;
}

function leafEntry(v: Rational): Entry {
  return { e: leaf(v), s: leafStats(v), c: canonLeaf(v) };
}

/**
 * Operand pairs for one unordered split: commutative operators put the larger
 * value first (then the compound side), − and ÷ are tried both ways round.
 */
function variants(op: TargetOp, x: Entry, y: Entry): Array<[Entry, Entry]> {
  if (op === '+' || op === '*') {
    const c = cmp(x.s.v, y.s.v);
    const xFirst = c > 0 || (c === 0 && x.s.ops >= y.s.ops);
    return [xFirst ? [x, y] : [y, x]];
  }
  return [
    [x, y],
    [y, x],
  ];
}

function combine(op: TargetOp, a: Entry, b: Entry, r: Rational): Entry {
  const e = { k: 'op', op, a: a.e, b: b.e } as const;
  return { e, s: combineStats(op, e, a.s, b.s, r), c: canonCombine(op, a.c, b.c, r) };
}

function solveGeneral(cards: readonly Rational[], target: Rational, rules: Rules): SolveResult {
  const n = cards.length;
  if (n > MAX_GENERAL_CARDS) throw new RangeError(`solver supports at most ${MAX_GENERAL_CARDS} cards, got ${n}`);
  const found = new Map<string, Found>();
  if (n === 0) return finish(found, rules.max);
  const full = (1 << n) - 1;
  const table: Entry[][] = new Array<Entry[]>(full + 1);

  const hit = (en: Entry): void => {
    if (eq(en.s.v, target)) keep(found, { e: en.e, s: en.s, canon: en.c.key, repr: toRepr(en.e) });
  };

  for (let i = 0; i < n; i++) {
    const en = leafEntry(cards[i]!);
    table[1 << i] = [en];
    if (!rules.all || n === 1) hit(en);
  }

  for (let mask = 1; mask <= full; mask++) {
    if ((mask & (mask - 1)) === 0) continue; // singletons done
    const isFull = mask === full;
    const best = new Map<string, Entry>();
    // Each unordered split {s, t} once: require s > t.
    for (let s = (mask - 1) & mask; s > 0; s = (s - 1) & mask) {
      const t = mask ^ s;
      if (s < t) continue;
      const left = table[s]!;
      const right = table[t]!;
      for (const x of left) {
        for (const y of right) {
          for (const op of rules.ops) {
            for (const [a, b] of variants(op, x, y)) {
              const r = applyOp(op, a.s.v, b.s.v);
              if (!allowed(r, rules)) continue;
              // For the whole deal only target hits matter, so only they are canonicalised.
              if (isFull) {
                if (eq(r, target)) hit(combine(op, a, b, r));
                continue;
              }
              const en = combine(op, a, b, r);
              const old = best.get(en.c.key);
              if (!old || en.s.cx < old.s.cx) best.set(en.c.key, en);
            }
          }
        }
      }
    }
    if (!isFull) {
      const list = [...best.values()];
      table[mask] = list;
      if (!rules.all) for (const en of list) hit(en);
    }
  }
  return finish(found, rules.max);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Which search `solveDetailed` uses: 'auto' picks the additive fast path when
 * it is exact (ops ⊆ {+, −} with +, non-negative integer cards and target),
 * else the subset DP. 'general' forces the subset DP (tests cross-check the two).
 */
export type SolveStrategy = 'auto' | 'general';

/** Distinct solutions and their total count. See `solve`. */
export function solveDetailed(
  cards: ReadonlyArray<number | Rational>,
  target: number | Rational,
  opts: SolveOptions = {},
  strategy: SolveStrategy = 'auto',
): SolveResult {
  const vals = cards.map(toRat);
  const t = toRat(target);
  const rules = rulesOf(opts);
  if (strategy === 'auto' && additiveEligible(vals, t, rules)) return solveAdditive(vals, t, rules);
  return solveGeneral(vals, t, rules);
}

/**
 * Distinct ways to make `target` from `cards` (each card at most once, all of
 * them with `mustUseAll`), deduplicated by canonical form and ordered simplest
 * first. Deterministic.
 */
export function solve(
  cards: ReadonlyArray<number | Rational>,
  target: number | Rational,
  opts: SolveOptions = {},
): Solution[] {
  return solveDetailed(cards, target, opts).solutions;
}

/**
 * Band A "make 10": subset sums over up to six dot cards, additions only
 * unless `allowSubtraction`. Same result shape as `solve`.
 */
export function solveMakeTen(
  cards: readonly number[],
  target = 10,
  opts: { allowSubtraction?: boolean; mustUseAll?: boolean; maxSolutions?: number } = {},
): Solution[] {
  return solveDetailed(cards, target, {
    ops: opts.allowSubtraction ? ['+', '-'] : ['+'],
    mustUseAll: opts.mustUseAll ?? false,
    maxSolutions: opts.maxSolutions ?? 100,
  }).solutions;
}

/**
 * Every value the cards can make under the rules (all cards with `mustUseAll`,
 * any non-empty subset otherwise), keyed by `key(value)`. Values only, no
 * expressions, so it is cheap; the deal generator picks targets from it.
 */
export function reachableValues(
  cards: ReadonlyArray<number | Rational>,
  opts: Omit<SolveOptions, 'maxSolutions'> = {},
): Map<string, Rational> {
  const vals = cards.map(toRat);
  const rules = rulesOf(opts);
  const n = vals.length;
  if (n > MAX_GENERAL_CARDS) throw new RangeError(`at most ${MAX_GENERAL_CARDS} cards, got ${n}`);
  const out = new Map<string, Rational>();
  if (n === 0) return out;
  const full = (1 << n) - 1;
  const table: Rational[][] = new Array<Rational[]>(full + 1);
  for (let i = 0; i < n; i++) table[1 << i] = [vals[i]!];
  for (let mask = 1; mask <= full; mask++) {
    let list = table[mask];
    if (!list) {
      const seen = new Map<string, Rational>();
      for (let s = (mask - 1) & mask; s > 0; s = (s - 1) & mask) {
        const t = mask ^ s;
        if (s < t) continue;
        for (const x of table[s]!) {
          for (const y of table[t]!) {
            for (const op of rules.ops) {
              const pairs: Array<[Rational, Rational]> = op === '+' || op === '*' ? [[x, y]] : [[x, y], [y, x]];
              for (const [a, b] of pairs) {
                const r = applyOp(op, a, b);
                if (allowed(r, rules)) seen.set(key(r), r);
              }
            }
          }
        }
      }
      list = [...seen.values()];
      table[mask] = list;
    }
    if (!rules.all || mask === full) for (const v of list) out.set(key(v), v);
  }
  return out;
}
