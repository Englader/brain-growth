/**
 * Fractions on the number line: unit fractions (f.unit), equivalent fractions
 * (f.equiv) and comparing fractions (f.compare).
 *
 * A fraction IS a place on the line: the whole from 0 to 1 is split into equal
 * parts and a/b is a hops of 1/b. Every line here is rational (`den`): ticks,
 * pads and taps sit at k/den, so a tap near 1/3 grades as exactly 1/3. No
 * typed fractions (there is no fraction keypad); answers are landings, or a
 * typed whole number (the missing numerator). Denominators ≤ 12 and at most
 * 12 parts on a line, so every part stays a comfortable tap target at 360 px.
 *
 * Misconception codes carry the feature prefix (`frac.*`), so their strings
 * live in the `mis.frac` locale block.
 *
 * Worked steps: the first one never shows the answer (it names the strategy's
 * first move, and is what a hint may show). A step that prints the answer as a
 * fraction also carries its value as `x`, which marks it as revealing for the
 * hint ladder (a fraction's value is not otherwise among its numbers).
 */
import { rat } from '../../rational';
import type { Rng } from '../../rng';
import type { GeneratedItem, GeneratorDef, LineSpec, SolutionStep } from '../types';
import { frac, gcd, lcm, pickByLevel, uniqMisconceptions } from '../util';

export interface FracLineConfig {
  mode: 'unit' | 'equiv' | 'compare';
}

/** Familiarity cost of a denominator: halves and quarters first, then thirds, fifths, sixths … twelfths. */
const DEN_COST: Record<number, number> = { 2: 0, 4: 0.08, 3: 0.12, 5: 0.2, 6: 0.22, 8: 0.26, 10: 0.28, 12: 0.34 };
const DENS = [2, 3, 4, 5, 6, 8, 10, 12];
/** Parts on one line: more would make each part narrower than a fingertip at 360 px. */
export const MAX_PARTS = 12;

/** Hops of 1/den from k0/den to k1/den, positions as exact divisions (never accumulated). */
function unitHops(k0: number, k1: number, den: number): SolutionStep[] {
  const out: SolutionStep[] = [];
  for (let k = k0; k < k1; k++) out.push({ k: 'hop', from: k / den, to: (k + 1) / den });
  return out;
}

// ── f.unit: "Hop to 3/4" on a line split into quarters ─────────────────────
interface Unit {
  a: number;
  b: number;
  range: 1 | 2;
}

function unitItem(level: number, rng: Rng): GeneratedItem {
  const { value, level: lv } = pickByLevel(
    rng,
    level,
    (r): Unit => {
      const range = r.chance(0.3) ? 2 : 1;
      const b = r.pick(DENS.filter((d) => d * range <= MAX_PARTS));
      return { a: r.int(1, range * b - 1), b, range };
    },
    ({ a, b, range }) =>
      0.05 + DEN_COST[b]! + (a > 1 ? 0.1 + 0.02 * Math.min(a, 8) : 0) + (range === 2 ? 0.2 : 0) + (a > b ? 0.15 : a === b ? 0.05 : 0),
  );
  const { a, b, range } = value;
  const line: LineSpec = {
    min: 0, max: range, start: 0, major: 1, minor: 1 / b, labelEvery: 1, steps: [1 / b],
    answerMode: 'land', den: b, labelStyle: 'fraction', pick: 'tap',
  };
  const solution: SolutionStep[] = [
    ...unitHops(0, a, b),
    { k: 'say', key: 'sol.frac.unitSplit', params: { d: b } },
    { k: 'say', key: 'sol.frac.unitHops', params: { n: a, d: b, x: a / b } },
  ];
  return {
    level: lv,
    prompt: { kind: 'locate', target: a / b, display: frac(a, b) },
    answer: { value: rat(a, b) },
    line,
    solution,
    misconceptions: uniqMisconceptions(
      [
        // Counted the tick at 0 as "one": one part short.
        { value: a >= 2 ? (a - 1) / b : NaN, code: 'frac.countedTicks' },
        // Split the whole 0–2 line into b parts instead of the unit 0–1.
        { value: range === 2 ? (2 * a) / b : NaN, code: 'frac.wholeLine' },
        // Went to the whole number a, ignoring the denominator.
        { value: a <= range ? a : NaN, code: 'frac.numeratorOnly' },
      ],
      a / b,
    ),
    features: { a, b, range, improper: a > b ? 1 : 0 },
  };
}

// ── f.equiv: 2/3 on a line in twelfths, or "2/3 = ?/12" ────────────────────
interface Equiv {
  a: number;
  b: number;
  m: number;
  /** Land a/b on a line ticked (and labelled) in (b·m)ths; otherwise type the missing numerator. */
  land: boolean;
}

function equivItem(level: number, rng: Rng): GeneratedItem {
  const { value, level: lv } = pickByLevel(
    rng,
    level,
    (r): Equiv => {
      const b = r.pick([2, 3, 4, 5, 6]);
      const m = r.int(2, Math.floor(MAX_PARTS / b));
      let a = r.int(1, b - 1);
      while (gcd(a, b) !== 1) a = r.int(1, b - 1);
      return { a, b, m, land: r.chance(0.5) };
    },
    ({ a, b, m, land }) =>
      0.05 + 0.08 * (m - 2) + 1.2 * DEN_COST[b]! + (a > 1 ? 0.2 : 0) + (land ? 0.18 : 0) + (2 * a === b ? -0.05 : 0) + 0.02 * a * m,
  );
  const { a, b, m, land } = value;
  const D = b * m;
  const an = a * m;
  const hops = unitHops(0, an, D);
  const say: SolutionStep[] = [
    { k: 'say', key: 'sol.frac.equivDen', params: { b, op: '*', m, bn: D } },
    { k: 'say', key: 'sol.frac.equiv', params: { a, b, m, an, bn: D, x: a / b } },
  ];
  if (land) {
    return {
      level: lv,
      prompt: { kind: 'locate', target: a / b, display: frac(a, b) },
      answer: { value: rat(a, b) },
      line: {
        min: 0, max: 1, start: 0, major: 1, minor: 1 / D, labelEvery: 1 / D, steps: [1 / D],
        answerMode: 'land', den: D, labelStyle: 'fraction', pick: 'tap',
      },
      solution: [...hops, ...say],
      misconceptions: uniqMisconceptions(
        [
          // Took a ticks of the finer grid, as if each tick were a 1/b.
          { value: a / D, code: 'frac.countedTicks' },
          // 2/3 → (2 + 9)/(3 + 9) = 11/12: added instead of multiplying.
          { value: a + D - b <= D ? (a + D - b) / D : NaN, code: 'frac.addSame' },
        ],
        a / b,
      ),
      features: { a, b, m, land: 1 },
    };
  }
  return {
    level: lv,
    prompt: { kind: 'expr', expr: frac(a, b), rhs: frac(null, D) },
    answer: { value: rat(an) },
    // Count mode: how many hops of 1/D reach the flag at a/b. Only whole numbers are labelled.
    line: {
      min: 0, max: 1, start: 0, flag: a / b, major: 1 / b, minor: 1 / D, labelEvery: 1, steps: [1 / D],
      answerMode: 'count', hopSize: 1 / D, den: D, labelStyle: 'fraction',
    },
    solution: [...hops, ...say],
    misconceptions: uniqMisconceptions(
      [
        { value: a + D - b, code: 'frac.addSame' },
        { value: a, code: 'frac.numeratorOnly' },
        { value: an + 1, code: 'frac.countedTicks' },
      ],
      an,
    ),
    features: { a, b, m, land: 0 },
  };
}

// ── f.compare: land on the bigger (or smaller) of two fractions ───────────
interface Cmp {
  a: number;
  b: number;
  c: number;
  d: number;
  pick: 'max' | 'min';
}

function compareKind({ a, b, c, d }: Cmp): number {
  if (b === d) return 0; // same denominator
  if (a === c) return 1; // same numerator: the "bigger denominator" trap
  if (b % d === 0 || d % b === 0) return 2; // one denominator divides the other
  return 3;
}

function compareItem(level: number, rng: Rng): GeneratedItem {
  const properLowest = (r: Rng, den: number): number => {
    let n = r.int(1, den - 1);
    while (gcd(n, den) !== 1) n = r.int(1, den - 1);
    return n;
  };
  const { value, level: lv } = pickByLevel(
    rng,
    level,
    (r): Cmp => {
      for (;;) {
        const b = r.pick(DENS);
        const kind = r.int(0, 2);
        const d = kind === 0 ? b : r.pick(DENS.filter((x) => lcm(x, b) <= MAX_PARTS));
        const a = properLowest(r, b);
        const c = kind === 1 && a < d && gcd(a, d) === 1 ? a : properLowest(r, d);
        if (a * d !== c * b) return { a, b, c, d, pick: r.chance(0.7) ? 'max' : 'min' };
      }
    },
    (v) => {
      const diff = Math.abs(v.a / v.b - v.c / v.d);
      return (
        [0.05, 0.3, 0.45, 0.62][compareKind(v)]! +
        0.25 * (1 - Math.min(1, diff / 0.5)) +
        (lcm(v.b, v.d) > 6 ? 0.05 : 0) +
        (v.pick === 'min' ? 0.05 : 0)
      );
    },
  );
  const { a, b, c, d, pick } = value;
  const L = lcm(b, d);
  const firstBigger = a * d > c * b;
  const wantFirst = pick === 'max' ? firstBigger : !firstBigger;
  const [rn, rd, wn, wd] = wantFirst ? [a, b, c, d] : [c, d, a, b];
  const [bn, bd, sn, sd] = firstBigger ? [a, b, c, d] : [c, d, a, b];
  const x = rn / rd;
  const solution: SolutionStep[] = [{ k: 'hop', from: 0, to: x }];
  if (a === c) solution.push({ k: 'say', key: 'sol.frac.sameNum', params: { n: a } });
  if (b === d) solution.push({ k: 'say', key: 'sol.frac.sameDen', params: { d: b } });
  else {
    solution.push(
      { k: 'say', key: 'sol.frac.commonDen', params: { l: L, b, d } },
      { k: 'say', key: 'sol.frac.common', params: { a, b, c, d, a2: (a * L) / b, c2: (c * L) / d, l: L, x } },
    );
  }
  solution.push(
    pick === 'max'
      ? { k: 'say', key: 'sol.frac.bigger', params: { n1: bn, d1: bd, n2: sn, d2: sd, x } }
      : { k: 'say', key: 'sol.frac.smaller', params: { n1: sn, d1: sd, n2: bn, d2: bd, x } },
  );
  // The wrong fraction, read through the belief that would choose it.
  const sign = pick === 'max' ? 1 : -1;
  const code = sign * (wd - rd) > 0 ? 'frac.biggerDen' : sign * (wn - rn) > 0 ? 'frac.numeratorOnly' : null;
  return {
    level: lv,
    prompt: { kind: 'compare', a: frac(a, b), b: frac(c, d), pick },
    answer: { value: rat(rn, rd) },
    line: {
      min: 0, max: 1, start: 0, major: 1, minor: 1 / L, labelEvery: 1, steps: [1 / L],
      answerMode: 'land', den: L, labelStyle: 'fraction', pick: 'tap',
    },
    solution,
    misconceptions: code ? uniqMisconceptions([{ value: wn / wd, code }], rn / rd) : [],
    features: { a, b, c, d, lcm: L, kind: compareKind(value), max: pick === 'max' ? 1 : 0 },
  };
}

export const fracLineGen: GeneratorDef<FracLineConfig> = {
  id: 'fracLine',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng, cfg) {
    switch (cfg.mode) {
      case 'unit':
        return unitItem(level, rng);
      case 'equiv':
        return equivItem(level, rng);
      case 'compare':
        return compareItem(level, rng);
    }
  },
};
