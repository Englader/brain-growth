/**
 * Deal generator for Target ("Make it"): cards, a target and rules, always
 * solvable, with the distinct solutions already found.
 *
 * Difficulty follows the generator convention (`pickByLevel` in
 * items/util.ts): a sampler proposes deals, a hand-built scorer maps each to
 * [0,1] from known factors, and the deal nearest the requested level wins.
 * The sampler leans its parameters toward the requested level so candidates
 * land near it; the scorer alone decides the achieved level. Factors:
 * - card count (Band A: 3–6 dot cards);
 * - target size;
 * - the simplest solution: how many operations and cards it needs, and its
 *   hardest operator (+ < − < × < ÷);
 * - number of distinct solutions (fewer is harder);
 * - whether every solution needs a fraction or a negative value (Band C);
 * - whether all cards must be used.
 *
 * Bands:
 * - A: make 10 from 3–6 dot cards of 1–9, additions only. A planted subset
 *   guarantees a solution; extra cards are distractors.
 * - B: 4 cards, + − × ÷, integer non-negative intermediates, targets 5–100.
 *   "Use all cards" appears only at high levels.
 * - C: 4 cards (a negative card at higher levels), negative intermediates,
 *   exact fractions at the top of the range, targets −30…100. No powers.
 *
 * Targets are drawn from the values the cards can actually make, so every
 * deal is solvable by construction; the solver then lists the ways.
 * Deterministic for a given rng state.
 */
import { clamp, clamp01, pickByLevel } from '../items/util';
import { isInteger, key, rat } from '../rational';
import type { Rng } from '../rng';
import type { TargetDealData } from './check';
import { TARGET_OPS, type TargetOp } from './expr';
import { reachableValues, solveDetailed, type SolveResult, type Solution } from './solver';

export type TargetBand = 'A' | 'B' | 'C';

export interface TargetRules {
  ops: TargetOp[];
  mustUseAll: boolean;
  allowNegativeIntermediates: boolean;
  allowFractionIntermediates: boolean;
}

export interface TargetDeal {
  band: TargetBand;
  cards: number[];
  target: number;
  rules: TargetRules;
  /** Distinct solutions, simplest first, at most `MAX_DEAL_SOLUTIONS`. */
  solutions: Solution[];
  /** Distinct solutions before the cap. */
  totalSolutions: number;
  /** Achieved difficulty on [0,1] (may differ from the requested level). */
  achievedLevel: number;
  /** Raw difficulty factors, logged so the scorer can be refitted. */
  features: Record<string, number>;
}

/**
 * Narrows a deal to one skill (the generator binding's config), so a deal
 * served as evidence for, say, multiplication facts actually needs ×.
 */
export interface DealOptions {
  /** Operators on offer (default: all four in Bands B and C). */
  ops?: readonly TargetOp[];
  /** Target range (defaults: B 5…100, C −30…100). */
  minTarget?: number;
  maxTarget?: number;
  /** Largest card (default: 6–12 in B, 9–13 in C, rising with level). */
  maxCard?: number;
  /**
   * The simplest solution must use this operator, or ('neg') a negative card
   * or value. The achieved level then measures difficulty beyond it: the
   * focus itself does not count as a harder operator or a needed negative.
   */
  focus?: TargetOp | 'neg';
}

/** Bump when `makeDeal` output for a given (seed, band, level) changes. */
export const DEAL_VERSION = 1;
export const MAX_DEAL_SOLUTIONS = 20;

/** Candidates drawn per deal: Band A deals are cheap, B and C need a solve each. */
const K: Record<TargetBand, number> = { A: 24, B: 12, C: 10 };

const OP_RANK: Record<TargetOp, number> = { '+': 0, '-': 1, '*': 2, '/': 3 };

interface Candidate {
  cards: number[];
  target: number;
  rules: TargetRules;
  res: SolveResult;
  focus?: DealOptions['focus'];
}

const ramp = (x: number, a: number, b: number): number => clamp01((x - a) / (b - a));

/** An integer in [lo, hi] centred on the level's share of the range. */
function levelInt(r: Rng, level: number, lo: number, hi: number, spread: number): number {
  return clamp(Math.round(lo + level * (hi - lo) + r.normal() * spread), lo, hi);
}

function solveCandidate(cards: number[], target: number, rules: TargetRules): SolveResult {
  return solveDetailed(cards, target, { ...rules, maxSolutions: MAX_DEAL_SOLUTIONS });
}

// ── Band A: make 10 ────────────────────────────────────────────────────────

const RULES_A: TargetRules = {
  ops: ['+'],
  mustUseAll: false,
  allowNegativeIntermediates: false,
  allowFractionIntermediates: false,
};

/** `k` parts in [lo, hi] summing to `total` (caller keeps it feasible). */
function composition(r: Rng, total: number, k: number, lo: number, hi: number): number[] {
  const parts: number[] = [];
  let rest = total;
  for (let i = 0; i < k - 1; i++) {
    const left = k - 1 - i;
    const p = r.int(Math.max(lo, rest - hi * left), Math.min(hi, rest - lo * left));
    parts.push(p);
    rest -= p;
  }
  parts.push(rest);
  return parts;
}

function sampleA(r: Rng, level: number): Candidate {
  const n = levelInt(r, level, 3, 6, 0.9);
  const k = Math.min(n, levelInt(r, level, 2, 4, 0.8));
  const planted = composition(r, 10, k, 1, 9);
  const extra = Array.from({ length: n - k }, () => r.int(1, 9));
  const cards = r.shuffle([...planted, ...extra]);
  return { cards, target: 10, rules: RULES_A, res: solveCandidate(cards, 10, RULES_A) };
}

/** How hard the bond a + (10 − a) is: 5 + 5 easiest, then 9 + 1, 8 + 2, 7 + 3, 6 + 4. */
const BOND_HARDNESS: Record<number, number> = { 5: 0, 1: 0.25, 2: 0.5, 3: 0.75, 4: 1 };

function bondHardness(best: Solution): number {
  if (best.cardsUsed !== 2 || best.expr.k !== 'op' || best.expr.a.k !== 'n' || best.expr.b.k !== 'n') return 1;
  const small = Math.min(best.expr.a.v.n, best.expr.b.v.n);
  return BOND_HARDNESS[small] ?? 1;
}

function scoreA(c: Candidate): number {
  const best = c.res.solutions[0]!;
  const fewWays = 1 - clamp01(Math.log2(c.res.total) / 3);
  return (
    0.35 * ((best.cardsUsed - 2) / 2) + 0.25 * ((c.cards.length - 3) / 3) + 0.15 * fewWays + 0.25 * bondHardness(best)
  );
}

// ── Bands B and C: four cards, four operators ──────────────────────────────

function pickTarget(r: Rng, pool: number[], level: number, buckets: ReadonlyArray<readonly [number, number]>): number | null {
  if (pool.length === 0) return null;
  const b = buckets[levelInt(r, level, 0, buckets.length - 1, 0.7)]!;
  const inBucket = pool.filter((v) => Math.abs(v) >= b[0] && Math.abs(v) <= b[1]);
  return r.pick(inBucket.length ? inBucket : pool);
}

/** Integer values the cards make under `rules`, within [lo, hi], excluding the cards themselves and 0. */
function targetPool(cards: number[], rules: TargetRules, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (const v of reachableValues(cards, rules).values()) {
    if (isInteger(v) && v.n >= lo && v.n <= hi && v.n !== 0 && !cards.includes(v.n)) out.push(v.n);
  }
  return out;
}

const B_BUCKETS = [
  [5, 20],
  [12, 40],
  [25, 70],
  [40, 100],
] as const;

/** Four overlapping size buckets spread geometrically over [lo, hi] (lo ≥ 1). */
function bucketsFor(lo: number, hi: number): Array<[number, number]> {
  const edge = (k: number): number => Math.round(lo * (hi / lo) ** (k / 4));
  return [0, 1, 2, 3].map((k) => [edge(k), edge(Math.min(4, k + 2))]);
}

/** Card values up to the level's cap, never above the binding's `maxCard`. */
function cardCap(r: Rng, level: number, caps: readonly number[], o: DealOptions): number {
  const allowed = caps.filter((c) => c <= (o.maxCard ?? Infinity));
  return allowed.length ? allowed[levelInt(r, level, 0, allowed.length - 1, 0.8)]! : o.maxCard!;
}

/**
 * With an operator focus, keep only targets the cards cannot make without that
 * operator: every solution then uses it, the simplest included.
 */
function focusPool(cards: number[], rules: TargetRules, pool: number[], focus: DealOptions['focus']): number[] {
  if (!focus || focus === 'neg') return pool;
  const without = reachableValues(cards, { ...rules, ops: rules.ops.filter((op) => op !== focus) });
  return pool.filter((v) => !without.has(key(rat(v))));
}

/** Whether the simplest solution uses the focus (operator, or a negative card or value). */
function meetsFocus(c: Candidate): boolean {
  const best = c.res.solutions[0];
  if (!best || !c.focus) return !!best;
  return c.focus === 'neg' ? best.usesNegative : best.opKinds.includes(c.focus);
}

function sampleB(r: Rng, level: number, o: DealOptions): Candidate | null {
  const maxCard = cardCap(r, level, [6, 9, 10, 12], o);
  const cards = Array.from({ length: 4 }, () => r.int(1, maxCard));
  const rules: TargetRules = {
    ops: TARGET_OPS.filter((op) => (o.ops ?? TARGET_OPS).includes(op)),
    mustUseAll: r.chance(0.8 * ramp(level, 0.5, 0.9)),
    allowNegativeIntermediates: false,
    allowFractionIntermediates: false,
  };
  const lo = Math.max(1, o.minTarget ?? 5);
  const hi = o.maxTarget ?? 100;
  const buckets = o.minTarget === undefined && o.maxTarget === undefined ? B_BUCKETS : bucketsFor(lo, hi);
  const target = pickTarget(r, focusPool(cards, rules, targetPool(cards, rules, lo, hi), o.focus), level, buckets);
  return target === null ? null : { cards, target, rules, res: solveCandidate(cards, target, rules), ...(o.focus ? { focus: o.focus } : {}) };
}

const C_BUCKETS = [
  [1, 24],
  [10, 50],
  [20, 100],
] as const;

function sampleC(r: Rng, level: number, o: DealOptions): Candidate | null {
  const maxCard = cardCap(r, level, [9, 10, 12, 13], o);
  const cards = Array.from({ length: 4 }, () => r.int(1, maxCard));
  const negFocus = o.focus === 'neg';
  if (r.chance((negFocus ? 0.3 : 0) + 0.5 * ramp(level, 0.3, 0.8))) cards[r.int(0, 3)] = -r.int(1, 9);
  const wantFraction = r.chance(ramp(level, 0.55, 0.95));
  const wantNegative = negFocus || r.chance(0.45 * ramp(level, 0.3, 0.8));
  const rules: TargetRules = {
    ops: TARGET_OPS.filter((op) => (o.ops ?? TARGET_OPS).includes(op)),
    mustUseAll: r.chance(0.35 + 0.55 * level),
    allowNegativeIntermediates: true,
    allowFractionIntermediates: wantFraction || r.chance(ramp(level, 0.3, 0.8)),
  };
  let pool = focusPool(cards, rules, targetPool(cards, rules, o.minTarget ?? -30, o.maxTarget ?? 100), o.focus);
  if (wantFraction) {
    const plain = reachableValues(cards, { ...rules, allowFractionIntermediates: false });
    const only = pool.filter((v) => !plain.has(key(rat(v))));
    if (only.length) pool = only;
  }
  if (wantNegative) {
    const plain = reachableValues(cards, { ...rules, allowNegativeIntermediates: false });
    const only = pool.filter((v) => !plain.has(key(rat(v))));
    if (only.length) pool = only;
  } else if (pool.some((v) => v > 0)) {
    pool = pool.filter((v) => v > 0);
  }
  const target = pickTarget(r, pool, level, C_BUCKETS);
  return target === null ? null : { cards, target, rules, res: solveCandidate(cards, target, rules), ...(o.focus ? { focus: o.focus } : {}) };
}

interface Traits {
  opsNeeded: number;
  cardsNeeded: number;
  hardestOp: number;
  opKinds: number;
  needsFraction: boolean;
  needsNegative: boolean;
}

/** Difficulty traits of the simplest solution; a focus operator (or negative) is the skill itself and does not count. */
function traits(c: Candidate): Traits {
  const best = c.res.solutions[0]!;
  const others = best.opKinds.filter((op) => op !== c.focus);
  return {
    opsNeeded: best.ops,
    cardsNeeded: best.cardsUsed,
    hardestOp: Math.max(0, ...others.map((op) => OP_RANK[op])),
    opKinds: Math.max(1, others.length),
    needsFraction: c.res.withoutFraction === 0,
    needsNegative: c.focus !== 'neg' && c.res.withoutNegative === 0,
  };
}

/** Shared four-card score in [0,1]. */
function scoreFour(c: Candidate): number {
  const t = traits(c);
  const size = clamp01(Math.log(Math.max(5, Math.abs(c.target)) / 5) / Math.log(20));
  const fewWays = 1 - clamp01(Math.log2(c.res.total) / 6);
  return (
    0.2 * ((t.opsNeeded - 1) / 2) +
    0.2 * (t.hardestOp / 3) +
    0.1 * ((t.opKinds - 1) / 2) +
    0.15 * size +
    0.25 * fewWays +
    0.1 * (c.rules.mustUseAll ? 1 : 0)
  );
}

function scoreC(c: Candidate): number {
  const t = traits(c);
  const negCard = c.focus !== 'neg' && c.cards.some((v) => v < 0);
  return 0.6 * scoreFour(c) + 0.25 * (t.needsFraction ? 1 : 0) + 0.1 * (t.needsNegative ? 1 : 0) + 0.05 * (negCard ? 1 : 0);
}

// ── Fallbacks (never expected; they keep `makeDeal` total) ─────────────────

function fallback(band: TargetBand): Candidate {
  const cards = band === 'A' ? [3, 7, 5] : [2, 3, 4, 5];
  const target = band === 'A' ? 10 : 14;
  const rules: TargetRules =
    band === 'A'
      ? RULES_A
      : {
          ops: [...TARGET_OPS],
          mustUseAll: false,
          allowNegativeIntermediates: band === 'C',
          allowFractionIntermediates: false,
        };
  return { cards, target, rules, res: solveCandidate(cards, target, rules) };
}

function retrying(band: TargetBand, level: number, o: DealOptions, draw: (r: Rng, level: number, o: DealOptions) => Candidate | null) {
  const tries = o.focus ? 60 : 20;
  return (r: Rng): Candidate => {
    for (let i = 0; i < tries; i++) {
      const c = draw(r, level, o);
      if (c && c.res.total > 0 && meetsFocus(c)) return c;
    }
    return fallback(band);
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

function features(band: TargetBand, c: Candidate): Record<string, number> {
  const t = traits(c);
  const f: Record<string, number> = {
    cards: c.cards.length,
    target: c.target,
    maxCard: Math.max(...c.cards.map(Math.abs)),
    opsNeeded: t.opsNeeded,
    cardsNeeded: t.cardsNeeded,
    hardestOp: t.hardestOp,
    opKinds: t.opKinds,
    solutions: c.res.total,
    mustUseAll: c.rules.mustUseAll ? 1 : 0,
    needsFraction: t.needsFraction ? 1 : 0,
    needsNegative: t.needsNegative ? 1 : 0,
    negCards: c.cards.filter((v) => v < 0).length,
  };
  if (band === 'A') f.bond = bondHardness(c.res.solutions[0]!);
  return f;
}

/**
 * A solvable deal for `band` near difficulty `level` ∈ [0,1], narrowed by
 * `opts` (Bands B and C). Uses only `rng` for randomness, so a stored seed
 * reproduces the deal exactly.
 */
export function makeDeal(rng: Rng, band: TargetBand, level: number, opts: DealOptions = {}): TargetDeal {
  const lv = clamp01(Number.isFinite(level) ? level : 0);
  const sample =
    band === 'A'
      ? retrying(band, lv, {}, sampleA)
      : band === 'B'
        ? retrying(band, lv, opts, sampleB)
        : retrying(band, lv, opts, sampleC);
  const score = band === 'A' ? scoreA : band === 'B' ? scoreFour : scoreC;
  const { value: c, level: achieved } = pickByLevel(rng, lv, sample, score, K[band]);
  return {
    band,
    cards: c.cards.slice(),
    target: c.target,
    rules: { ...c.rules, ops: [...c.rules.ops] },
    solutions: c.res.solutions,
    totalSolutions: c.res.total,
    achievedLevel: achieved,
    features: features(band, c),
  };
}

/** JSON-safe data for an item's `custom` 'target.deal' prompt (see `readDealData`). */
export function toDealData(deal: TargetDeal): TargetDealData {
  return {
    cards: deal.cards.slice(),
    target: deal.target,
    ops: [...deal.rules.ops],
    mustUseAll: deal.rules.mustUseAll,
    allowNegativeIntermediates: deal.rules.allowNegativeIntermediates,
    allowFractionIntermediates: deal.rules.allowFractionIntermediates,
    ways: deal.solutions.map((s) => s.repr),
    total: deal.totalSolutions,
  };
}
