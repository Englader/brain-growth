/**
 * Estimation ranges (B/C): no single exact answer.
 *
 * The child sees a quantity (a sum of several numbers, a product such as
 * 38·21, a quotient, or a percent of a number) and sets two handles on a
 * ruler. Success: the true value lies inside [lo, hi] AND hi − lo ≤ maxWidth.
 * The allowed width comes from a relative tolerance that tightens with level,
 * rounded down to a friendly number so it does not give the magnitude away;
 * the ruler starts at 0 and ends at a round number well past the truth, at a
 * random distance, so its length does not give the answer away either.
 *
 * The true value is not stored in the puzzle (the UI must not show it before
 * the child is done); `estimateTruth` computes it exactly (a Rational).
 *
 * Violated constraint ids: `wide` (hi − lo > maxWidth), `below` (the whole
 * range lies below the true value: move it up), `above` (the whole range lies
 * above it: move it down), `answer` (not two finite numbers). The answer is
 * normalised, so handles may be given in either order.
 * Focus ids in hints: `quantity`, `ruler`.
 */
import { cmp, fromNumber, rat, toNumber, type Rational } from '../../core/rational';
import type { Rng } from '../../core/rng';
import type { BandId } from '../../core/types';
import { fail, ok, type CheckResult, type PuzzleHint, type PuzzleTypeDef } from '../types';
import { assertBand, clamp01, niceCeilMultiple, pickByLevel, uniqCanon } from '../util';

export type Quantity =
  | { kind: 'sum'; terms: number[] }
  | { kind: 'product'; a: number; b: number }
  /** a : b, usually not exact (Band C). */
  | { kind: 'quotient'; a: number; b: number }
  /** pct % of `of` (Band C). */
  | { kind: 'percent'; pct: number; of: number };

export interface Ruler {
  min: number;
  max: number;
  /** Labelled tick spacing. */
  major: number;
  /** Handle granularity: handles land on multiples of `snap`. Divides maxWidth and max. */
  snap: number;
}

export interface EstimatePuzzle {
  q: Quantity;
  /** Widest allowed range (hi − lo). A multiple of `ruler.snap`. */
  maxWidth: number;
  ruler: Ruler;
}

/** [lo, hi] handle positions (either order). */
export type EstimateAnswer = [number, number];

export function estimateTruth(q: Quantity): Rational {
  switch (q.kind) {
    case 'sum':
      return rat(q.terms.reduce((s, x) => s + x, 0));
    case 'product':
      return rat(q.a * q.b);
    case 'quotient':
      return rat(q.a, q.b);
    case 'percent':
      return rat(q.pct * q.of, 100);
  }
}

// ---------------------------------------------------------------- generation

/** Relative half-widths, loosest first. Band B uses the first four. */
const TOLERANCES = [0.3, 0.2, 0.15, 0.1, 0.05] as const;
const KIND_INDEX = { sum: 0, product: 1, quotient: 2, percent: 3 } as const;
const EASY_PCT = [10, 20, 25, 50, 75];
const MID_PCT = [15, 30, 40, 60, 80];
const ODD_PCT = [5, 12, 35, 45, 65, 85];

/** Integer with exactly `d` digits, avoiding multiples of 10 (those need no estimating). */
function digitsInt(rng: Rng, d: number): number {
  let x = 0;
  do x = rng.int(10 ** (d - 1), 10 ** d - 1);
  while (x % 10 === 0);
  return x;
}

function sampleQuantity(rng: Rng, band: BandId): { q: Quantity; qScore: number; digits: number } {
  const kinds = band === 'C' ? (['sum', 'product', 'quotient', 'percent'] as const) : (['sum', 'product'] as const);
  const kind = rng.pick(kinds);
  switch (kind) {
    case 'sum': {
      const n = band === 'C' ? rng.int(3, 5) : rng.int(3, 4);
      const d = band === 'C' ? rng.pick([2, 3, 3]) : rng.pick([2, 2, 3]);
      const terms = Array.from({ length: n }, () => digitsInt(rng, d));
      return { q: { kind, terms }, qScore: 0.1 * (n - 3) + (d === 3 ? 0.25 : 0), digits: d };
    }
    case 'product': {
      const forms: Array<[number, number, number]> =
        band === 'C' ? [[2, 2, 0.5], [3, 1, 0.45], [3, 2, 0.75]] : [[2, 1, 0.2], [2, 2, 0.5]];
      const [da, db, s] = rng.pick(forms);
      const b = db === 1 ? rng.int(3, 9) : digitsInt(rng, db);
      return { q: { kind, a: digitsInt(rng, da), b }, qScore: s, digits: da + db };
    }
    case 'quotient': {
      const forms: Array<[number, number, number]> = [[3, 1, 0.55], [4, 1, 0.65], [4, 2, 0.9]];
      const [da, db, s] = rng.pick(forms);
      const b = db === 1 ? rng.int(3, 9) : digitsInt(rng, db);
      return { q: { kind, a: digitsInt(rng, da), b }, qScore: s, digits: da + db };
    }
    case 'percent': {
      const tier = rng.int(0, 2);
      const pct = rng.pick([EASY_PCT, MID_PCT, ODD_PCT][tier]!);
      return { q: { kind, pct, of: rng.int(40, 2000) }, qScore: [0.45, 0.6, 0.8][tier]!, digits: 0 };
    }
  }
}

/** Largest "friendly" integer ≤ x from {1, 1.5, 2, 2.5, 3, 4, 5, 6, 8}·10^k (at least 1). */
export function friendlyFloor(x: number): number {
  let best = 1;
  for (let e = 0; 10 ** e <= x; e++) {
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]) {
      const v = m * 10 ** e;
      if (Number.isInteger(v) && v <= x) best = Math.max(best, v);
    }
  }
  return best;
}

/** Largest {1,2,5}·10^j that divides `width` and gives at least 8 steps across it (at least 1). */
export function snapFor(width: number): number {
  let best = 1;
  for (let e = 0; 10 ** e <= width; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v * 8 <= width && width % v === 0) best = Math.max(best, v);
    }
  }
  return best;
}

interface Sample {
  puzzle: EstimatePuzzle;
  features: Record<string, number>;
  score: number;
}

function sampleEstimate(rng: Rng, band: BandId): Sample {
  const { q, qScore, digits } = sampleQuantity(rng, band);
  const T = toNumber(estimateTruth(q));
  const tIdx = rng.int(0, band === 'C' ? 4 : 3);
  const maxWidth = friendlyFloor(2 * TOLERANCES[tIdx]! * T);
  const snap = snapFor(maxWidth);
  const top = Math.max(T * (1.3 + 1.2 * rng.next()), T + maxWidth);
  const major = niceCeilMultiple(top / 8, snap);
  const max = Math.ceil(top / major) * major;
  const tol = maxWidth / (2 * T);
  const tight = clamp01((0.3 - tol) / 0.25);
  return {
    puzzle: { q, maxWidth, ruler: { min: 0, max, major, snap } },
    features: {
      kind: KIND_INDEX[q.kind],
      q: qScore,
      digits,
      terms: q.kind === 'sum' ? q.terms.length : 2,
      tol,
      tight,
    },
    score: 0.5 * qScore + 0.5 * tight,
  };
}

// ---------------------------------------------------------------- solving, checking, hints

/** Multiples of `s` just below and above an exact value. */
function bracket(t: Rational, s: number): [number, number] {
  const lo = Math.floor(t.n / (t.d * s)) * s;
  const hi = Math.ceil(t.n / (t.d * s)) * s;
  return [lo, hi];
}

function solveEstimate(p: EstimatePuzzle): EstimateAnswer[] {
  const t = estimateTruth(p.q);
  const { snap, min, max } = p.ruler;
  const [tLo, tHi] = bracket(t, snap);
  // The widest allowed range, as centred on the truth as the snap grid allows, kept on the ruler.
  const spare = p.maxWidth - (tHi - tLo);
  let lo = Math.max(min, tLo - Math.floor(spare / 2 / snap) * snap);
  let hi = lo + p.maxWidth;
  if (hi > max) {
    hi = max;
    lo = hi - p.maxWidth;
  }
  return uniqCanon<EstimateAnswer>([[tLo, tHi], [lo, hi]]);
}

function checkEstimate(p: EstimatePuzzle, answer: EstimateAnswer): CheckResult {
  if (!Array.isArray(answer) || answer.length !== 2 || !answer.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    return fail(['answer']);
  }
  const loN = Math.min(answer[0], answer[1]);
  const hiN = Math.max(answer[0], answer[1]);
  // Handles sit on the snap grid (integers), so the width compares exactly as numbers;
  // containment compares exactly against the rational truth.
  const t = estimateTruth(p.q);
  const violated: string[] = [];
  if (hiN - loN > p.maxWidth + 1e-9) violated.push('wide');
  if (cmp(fromNumber(hiN), t) < 0) violated.push('below');
  if (cmp(fromNumber(loN), t) > 0) violated.push('above');
  return violated.length ? fail(violated) : ok();
}

/** Round to the leading place value: 38 → 40, 347 → 300, 7 → 7. */
export function roundLead(x: number): number {
  if (Math.abs(x) < 10) return Math.round(x);
  const place = 10 ** Math.floor(Math.log10(Math.abs(x)));
  return Math.round(x / place) * place;
}

function roughly(q: Quantity): { first: PuzzleHint; value: number } {
  switch (q.kind) {
    case 'sum': {
      const to = 10 ** (String(Math.max(...q.terms)).length - 1);
      const value = q.terms.reduce((s, x) => s + Math.round(x / to) * to, 0);
      return { first: { key: 'puzzle.hint.estimate.roundEach', params: { to }, focus: ['quantity'] }, value };
    }
    case 'product': {
      const a = roundLead(q.a);
      const b = roundLead(q.b);
      return { first: { key: 'puzzle.hint.estimate.roundBoth', params: { a, b }, focus: ['quantity'] }, value: a * b };
    }
    case 'quotient': {
      const b = roundLead(q.b);
      const value = Math.max(1, roundLead(q.a / b));
      return { first: { key: 'puzzle.hint.estimate.friendlyDivide', params: { a: value * b, b }, focus: ['quantity'] }, value };
    }
    case 'percent': {
      const tenth = Math.round(q.of / 10);
      // Rough on purpose: a rounded tenth times the number of tenths.
      return {
        first: { key: 'puzzle.hint.estimate.tenPercent', params: { tenth }, focus: ['quantity'] },
        value: Math.round((roundLead(tenth) * q.pct) / 10),
      };
    }
  }
}

function hintEstimate(p: EstimatePuzzle, tier: number): PuzzleHint | null {
  const r = roughly(p.q);
  if (tier === 1) return r.first;
  if (tier === 2) return { key: 'puzzle.hint.estimate.about', params: { value: r.value }, focus: ['quantity'] };
  if (tier === 3) {
    // A window twice the allowed width that holds the truth: the child still narrows it.
    const t = toNumber(estimateTruth(p.q));
    const { snap, min, max } = p.ruler;
    let lo = Math.max(min, Math.floor((t - 0.7 * p.maxWidth) / snap) * snap);
    const hi = Math.min(max, lo + 2 * p.maxWidth);
    lo = Math.max(min, hi - 2 * p.maxWidth);
    return { key: 'puzzle.hint.estimate.between', params: { lo, hi }, focus: ['ruler'] };
  }
  return null;
}

// ---------------------------------------------------------------- definition

const BANDS: readonly BandId[] = ['B', 'C'];

export const estimatePuzzle: PuzzleTypeDef<EstimatePuzzle, EstimateAnswer> = {
  id: 'estimate',
  version: 1,
  bands: BANDS,

  generate(rng, band, level) {
    assertBand('estimate', BANDS, band);
    const { value, level: achieved } = pickByLevel(rng, clamp01(level), (r) => sampleEstimate(r, band), (s) => s.score);
    return { puzzle: value.puzzle, achievedLevel: achieved, features: value.features };
  },

  check: checkEstimate,
  solve: solveEstimate,
  hint: hintEstimate,
};
