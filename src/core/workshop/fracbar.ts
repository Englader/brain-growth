/**
 * Workshop fraction bar (9a): split a bar into equal parts with ± steppers,
 * shade parts by tapping. The construction is checked, not a typed number,
 * and every equivalent construction is accepted (2/4 and 4/8 for 1/2) unless
 * the task asks for a given number of parts.
 *
 * Tasks:
 * - `make` (f.unit): "Shade n/d of the bar." Any number of parts.
 * - `scaleUp` (f.equiv): "Show n/d using P parts", P = k·d: shade k·n.
 * - `scaleDown` (f.equiv): "Show n/d using P parts" with n/d not in lowest
 *   terms and P = d/k: shade n/k (e.g. 6/8 with 4 parts: shade 3).
 *
 * `sizes` (optional in a given construction) supports a later free-cut
 * enhancement (tap a part to halve it, drag a cut): relative part widths.
 * With the stepper UI parts are always equal and `sizes` is omitted.
 */
import type { Rng } from '../rng';
import { add, eq, rat, type Rational } from '../rational';
import type { SolutionStep } from '../items/types';
import { pickByLevel } from '../items/util';
import { WORKSHOP_SOL_KEYS } from './keys';

export type FracSkill = 'f.unit' | 'f.equiv';
export type FracTask = 'make' | 'scaleUp' | 'scaleDown';

/** Most parts the bar can be split into (a 360 px screen keeps ~25 px per part). */
export const MAX_BAR_PARTS = 12;

export interface FracBarTarget {
  /** The fraction as shown (not necessarily in lowest terms for `scaleDown`). */
  n: number;
  d: number;
  /** Required number of parts; absent = any. */
  parts?: number;
}

export interface MadeFracBar {
  task: FracTask;
  target: FracBarTarget;
  achievedLevel: number;
  features: Record<string, number>;
}

const gcd = (a: number, b: number): number => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};

const isPow2 = (n: number): boolean => (n & (n - 1)) === 0;

// ── Generator ───────────────────────────────────────────────────────────────

interface FracCand {
  task: FracTask;
  target: FracBarTarget;
  /** Lowest-terms fraction and the scale factor between shown and built. */
  baseN: number;
  baseD: number;
  k: number;
}

function sampleUnit(r: Rng): FracCand {
  const d = r.int(2, 10);
  let n = r.chance(0.5) ? 1 : r.int(1, d - 1);
  while (gcd(n, d) !== 1) n--;
  return { task: 'make', target: { n, d }, baseN: n, baseD: d, k: 1 };
}

function sampleEquiv(r: Rng): FracCand {
  for (;;) {
    const d = r.int(2, 6);
    const n = r.int(1, d - 1);
    if (gcd(n, d) !== 1) continue;
    const k = r.int(2, 4);
    if (k * d > MAX_BAR_PARTS) continue;
    if (r.chance(0.5)) return { task: 'scaleUp', target: { n, d, parts: k * d }, baseN: n, baseD: d, k };
    return { task: 'scaleDown', target: { n: k * n, d: k * d, parts: d }, baseN: n, baseD: d, k };
  }
}

function fracFeatures(c: FracCand): Record<string, number> {
  return {
    n: c.target.n,
    d: c.target.d,
    parts: c.target.parts ?? c.target.d,
    baseN: c.baseN,
    baseD: c.baseD,
    k: c.k,
    big: c.k * c.baseD,
    unit: c.baseN === 1 ? 1 : 0,
    task: ['make', 'scaleUp', 'scaleDown'].indexOf(c.task),
  };
}

export function scoreFracBar(skill: FracSkill, f: Record<string, number>): number {
  const g = (k: string): number => f[k] ?? 0;
  if (skill === 'f.unit') {
    // Halves and quarters first; thirds, fifths… need an unfamiliar split; then non-unit fractions.
    return (
      0.04 +
      0.035 * (g('d') - 2) +
      0.1 * (isPow2(g('d')) ? 0 : 1) +
      0.3 * (g('baseN') > 1 ? 1 : 0) +
      0.025 * g('baseN')
    );
  }
  return (
    // Shrinking (6/8 with 4 parts) is harder than growing; then non-unit, bigger factor, bigger denominators.
    0.04 +
    0.3 * (g('task') === 2 ? 1 : 0) +
    0.2 * (g('baseN') > 1 ? 1 : 0) +
    0.1 * (g('k') - 2) +
    0.05 * (g('baseD') - 2) +
    0.015 * g('big')
  );
}

export function makeFracBar(rng: Rng, skill: FracSkill, level: number): MadeFracBar {
  const { value, level: achievedLevel } = pickByLevel(
    rng,
    level,
    (r) => {
      const c = skill === 'f.unit' ? sampleUnit(r) : sampleEquiv(r);
      return { c, features: fracFeatures(c) };
    },
    (x) => scoreFracBar(skill, x.features),
    32,
  );
  return { task: value.c.task, target: value.c.target, achievedLevel, features: value.features };
}

/** The fraction the item asks for, in lowest terms (the item's `answer.value`). */
export function fracBarValue(t: FracBarTarget): Rational {
  return rat(t.n, t.d);
}

// ── Checker ─────────────────────────────────────────────────────────────────

export interface FracBarGiven {
  /** Number of parts the bar is split into. */
  parts: number;
  /** Shaded part indices (0-based), or just how many are shaded (equal parts only). */
  shaded: number[] | number;
  /** Relative part widths (free-cut enhancement); absent = equal parts. */
  sizes?: number[];
}

export type FracMisconception = 'frac.partsVsShaded' | 'frac.unequalParts' | 'frac.numeratorKept';
export const FRAC_MISCONCEPTIONS: readonly FracMisconception[] = [
  'frac.partsVsShaded',
  'frac.unequalParts',
  'frac.numeratorKept',
];

export type FracBarReason = 'parse' | 'wrongParts' | 'unequal' | 'wrongAmount';

export interface FracBarCheck {
  ok: boolean;
  /** The construction cannot be read (bad counts or indices): ask again. */
  invalid: boolean;
  reason?: FracBarReason;
  /** Shaded share of the whole bar, by width; null when invalid. */
  amount: Rational | null;
  misconception: FracMisconception | null;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

function readGiven(g: FracBarGiven): { parts: number; count: number; amount: Rational; equal: boolean } | null {
  const { parts, shaded, sizes } = g;
  if (!isInt(parts) || parts < 1 || parts > MAX_BAR_PARTS) return null;
  if (sizes !== undefined) {
    if (!Array.isArray(sizes) || sizes.length !== parts || !sizes.every((s) => isInt(s) && s >= 1 && s <= 1000)) return null;
  }
  const equal = !sizes || sizes.every((s) => s === sizes[0]);
  if (typeof shaded === 'number') {
    if (!isInt(shaded) || shaded < 0 || shaded > parts) return null;
    if (!equal) return null; // a count says nothing about which unequal parts
    return { parts, count: shaded, amount: rat(shaded, parts), equal };
  }
  if (!Array.isArray(shaded) || !shaded.every((i) => isInt(i) && i >= 0 && i < parts)) return null;
  if (new Set(shaded).size !== shaded.length) return null;
  const w = sizes ?? new Array<number>(parts).fill(1);
  const total = w.reduce((s, x) => s + x, 0);
  const got = shaded.reduce((s, i) => s + (w[i] ?? 0), 0);
  return { parts, count: shaded.length, amount: rat(got, total), equal };
}

/**
 * Checks a built bar against the target. In order: readable (`parse`,
 * invalid), the required number of parts (`wrongParts`), then the shaded
 * share. An unequal split whose piece COUNT matches but whose share does not
 * is `unequal` (`frac.unequalParts`). A wrong share is tested for
 * `frac.partsVsShaded` (shaded the unshaded share, or shaded:unshaded equals
 * the target, e.g. 1 of 4 shaded for 1/3) and `frac.numeratorKept` (more
 * parts but the same number shaded, e.g. 2 of 6 for 2/3; checked first when
 * the task fixes the number of parts).
 */
export function checkFracBar(target: FracBarTarget, given: FracBarGiven): FracBarCheck {
  const g = readGiven(given);
  if (!g) return { ok: false, invalid: true, reason: 'parse', amount: null, misconception: null };
  const want = rat(target.n, target.d);
  const fail = (reason: FracBarReason, misconception: FracMisconception | null = null): FracBarCheck => ({
    ok: false,
    invalid: false,
    reason,
    amount: g.amount,
    misconception,
  });
  if (target.parts !== undefined && g.parts !== target.parts) return fail('wrongParts');
  if (eq(g.amount, want)) return { ok: true, invalid: false, amount: g.amount, misconception: null };
  if (!g.equal && eq(rat(g.count, g.parts), want)) return fail('unequal', 'frac.unequalParts');
  // With the parts fixed by the task, shading the shown numerator is the likelier story
  // (2 of 6 for 2/3 is also the complement 1/3, by coincidence).
  const kept = g.equal && g.parts !== target.d && g.count === target.n;
  if (kept && target.parts !== undefined) return fail('wrongAmount', 'frac.numeratorKept');
  if (eq(add(g.amount, want), rat(1))) return fail('wrongAmount', 'frac.partsVsShaded');
  if (g.equal && g.count < g.parts && eq(rat(g.count, g.parts - g.count), want)) return fail('wrongAmount', 'frac.partsVsShaded');
  if (kept) return fail('wrongAmount', 'frac.numeratorKept');
  return fail('wrongAmount');
}

// ── Repr (the `built` response) ─────────────────────────────────────────────

/**
 * Locale-free repr: `<parts>|<shaded indices>`, e.g. "6|0,2,4" or "4|" (none
 * shaded); with unequal parts the widths replace the count: "2+1+1|0".
 */
export function fracBarRepr(g: FracBarGiven): string {
  const shaded = typeof g.shaded === 'number' ? Array.from({ length: g.shaded }, (_, i) => i) : [...g.shaded].sort((a, b) => a - b);
  const head = g.sizes && !g.sizes.every((s) => s === g.sizes![0]) ? g.sizes.join('+') : String(g.parts);
  return `${head}|${shaded.join(',')}`;
}

export function parseFracBarRepr(repr: string): FracBarGiven | null {
  const m = /^(\d{1,4}(?:\+\d{1,4})*)\|((?:\d{1,3}(?:,\d{1,3})*)?)$/.exec(typeof repr === 'string' ? repr.trim() : '');
  if (!m) return null;
  const head = m[1]!.split('+').map(Number);
  const shaded = m[2] ? m[2].split(',').map(Number) : [];
  if (head.length === 1) return { parts: head[0]!, shaded };
  return { parts: head.length, shaded, sizes: head };
}

/** Item payload (numbers only): the target as shown and the required parts (0 = any). */
export type FracBarData = {
  n: number;
  d: number;
  parts: number;
};

export function fracBarData(t: FracBarTarget): FracBarData {
  return { n: t.n, d: t.d, parts: t.parts ?? 0 };
}

export function readFracBarData(data: unknown): FracBarTarget | null {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;
  if (!isInt(o.n) || !isInt(o.d) || o.d < 1 || o.n < 0 || o.n > o.d || o.d > 100) return null;
  const parts = o.parts === undefined ? 0 : o.parts;
  if (!isInt(parts) || parts < 0 || parts > MAX_BAR_PARTS) return null;
  return parts === 0 ? { n: o.n, d: o.d } : { n: o.n, d: o.d, parts };
}

/** Checker for the `built` response: target from item data, construction from `repr`. */
export function checkFracBarRepr(data: unknown, repr: string): FracBarCheck & { given: string } {
  const target = readFracBarData(data);
  const given = parseFracBarRepr(repr);
  if (!target || !given) {
    return { ok: false, invalid: true, reason: 'parse', amount: null, misconception: null, given: String(repr).slice(0, 60) };
  }
  const res = checkFracBar(target, given);
  return { ...res, given: res.invalid ? String(repr).slice(0, 60) : fracBarRepr(given) };
}

// ── Worked solution ─────────────────────────────────────────────────────────

/** Worked steps (`sol.workshop.frac*`, see ./keys.ts). */
export function fracBarSolutionSteps(task: FracTask, t: FracBarTarget): SolutionStep[] {
  const parts = t.parts ?? t.d;
  const shade = (t.n * parts) / t.d;
  const steps: SolutionStep[] = [];
  if (task === 'scaleUp') {
    steps.push({ k: 'say', key: WORKSHOP_SOL_KEYS.fracScaleUp, params: { k: parts / t.d, d: t.d, parts } });
  } else if (task === 'scaleDown') {
    steps.push({ k: 'say', key: WORKSHOP_SOL_KEYS.fracScaleDown, params: { k: t.d / parts, d: t.d, parts } });
  }
  steps.push({ k: 'say', key: WORKSHOP_SOL_KEYS.fracSplit, params: { parts } });
  steps.push({ k: 'say', key: WORKSHOP_SOL_KEYS.fracShade, params: { shade, parts } });
  return steps;
}
