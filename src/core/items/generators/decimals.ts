/**
 * Decimals and percent on the number line: tenths and hundredths (d.tenths),
 * comparing decimals (d.compare), adding and subtracting decimals (d.addsub)
 * and percent of an amount (d.percent).
 *
 * All arithmetic is on integers (hundredths), and every position on a line
 * is an exact division k/den, so 0.1 + 0.2 lands on 0.3 for a child. Zoomed
 * windows (2–3 in tenths, 0.3–0.4 in hundredths) keep at most 12 parts on a
 * line where the answer is tapped. Misconception codes are `frac.dec.*` and
 * `frac.pct.*` (strings in the `mis.frac` block). As in fractions.ts, the first
 * worked step never shows the answer, and every number a step prints is one
 * of its params (so the hint ladder can tell when a step would give it away).
 */
import { rat } from '../../rational';
import type { Rng } from '../../rng';
import type { GeneratorDef, LineSpec, SolutionStep } from '../types';
import { bin, borrows, carries, num, pickByLevel, subSmallerFromLarger, uniqMisconceptions } from '../util';
import { MAX_PARTS } from './fractions';

export interface DecLineConfig {
  mode: 'tenths' | 'compare';
}

/** Decimal places of a value given in hundredths: 350 → 1 ("3,5"), 345 → 2, 300 → 0. */
const places = (h: number): number => (h % 100 === 0 ? 0 : h % 10 === 0 ? 1 : 2);
/** Distance from an easy anchor (the ends and the middle of a tenth). */
const anchorDist = (digit: number): number => Math.min(Math.abs(digit - 5), digit, 10 - digit);

/** Hops of 1/den from k0/den to k1/den (exact divisions). */
function tickHops(k0: number, k1: number, den: number): SolutionStep[] {
  const out: SolutionStep[] = [];
  for (let k = k0; k < k1; k++) out.push({ k: 'hop', from: k / den, to: (k + 1) / den });
  return out;
}

// ── d.tenths: locate or read a decimal on a zoomed window ────────────────
interface Tenths {
  hundredths: boolean;
  read: boolean;
  w: number;
  t: number;
  h: number;
}

function tenthsItem(level: number, rng: Rng): ReturnType<GeneratorDef['generate']> {
  const { value, level: lv } = pickByLevel(
    rng,
    level,
    (r): Tenths => {
      const hundredths = r.chance(0.5);
      return {
        hundredths,
        read: r.chance(0.4),
        w: r.chance(0.5) ? 0 : r.int(1, 9),
        t: hundredths ? r.int(0, 9) : r.int(1, 9),
        h: hundredths ? r.int(1, 9) : 0,
      };
    },
    (v) =>
      0.05 +
      (v.hundredths ? 0.4 : 0) +
      (v.w > 0 ? 0.15 : 0) +
      (v.read ? 0.2 : 0.05) +
      0.04 * anchorDist(v.hundredths ? v.h : v.t),
  );
  const { hundredths, read, w, t, h } = value;
  const den = hundredths ? 100 : 10;
  // Window [lo, lo + 10 ticks] in units of 1/den; the answer is `steps` ticks in.
  const lo = hundredths ? 10 * (10 * w + t) : 10 * w;
  const steps = hundredths ? h : t;
  const V = 100 * w + 10 * t + h; // hundredths
  const x = V / 100;
  const line: LineSpec = {
    min: lo / den, max: (lo + 10) / den, start: lo / den, major: 5 / den, minor: 1 / den, labelEvery: 10 / den,
    steps: [1 / den], answerMode: 'land', den, labelStyle: 'decimal',
    ...(read ? { flag: x } : { pick: 'tap' as const }),
  };
  const mis: Array<{ value: number; code: string }> = [];
  if (read) {
    // Counted the tick at the start as "one".
    if (steps < 10) mis.push({ value: (lo + steps + 1) / den, code: 'frac.countedTicks' });
    // 2,7 written 2,07; 0,37 written 0,7: tenths and hundredths swapped places.
    mis.push({ value: hundredths ? (10 * w + h) / 10 : (100 * w + t) / 100, code: 'frac.dec.tenthsAsHundredths' });
  } else mis.push({ value: (lo + steps - 1) / den, code: 'frac.countedTicks' });
  return {
    level: lv,
    prompt: read ? { kind: 'read', value: x } : { kind: 'locate', target: x, display: num(x) },
    answer: { value: rat(V, 100) },
    line,
    solution: [
      ...tickHops(lo, lo + steps, den),
      { k: 'say', key: hundredths ? 'sol.frac.hundredthsWindow' : 'sol.frac.tenthsWindow', params: { lo: lo / den, hi: (lo + 10) / den, n: 10 } },
      { k: 'say', key: hundredths ? 'sol.frac.hundredthsHops' : 'sol.frac.tenthsHops', params: { lo: lo / den, n: steps, x } },
    ],
    misconceptions: uniqMisconceptions(mis, x),
    features: { w, t, h, hundredths: hundredths ? 1 : 0, read: read ? 1 : 0 },
  };
}

// ── d.compare: land on the bigger (or smaller) of two decimals ────────────
interface DCmp {
  /** Values in hundredths. */
  x: number;
  y: number;
  kind: number;
  pick: 'max' | 'min';
}

/** Zoomed window [lo, hi] (hundredths) and its den, or null when it would hold more than MAX_PARTS parts. */
function compareWindow(x: number, y: number, kind: number): { lo: number; hi: number; den: number } | null {
  const lo0 = Math.floor(Math.min(x, y) / 10) * 10;
  const hi0 = Math.max(lo0 + 10, Math.ceil(Math.max(x, y) / 10) * 10);
  // Two tenths: the whole unit, so neither number is a labelled end.
  if (kind === 0) {
    const lo = Math.floor(Math.min(x, y) / 100) * 100;
    return Math.max(x, y) <= lo + 100 ? { lo, hi: lo + 100, den: 10 } : null;
  }
  const all = [x, y, lo0, hi0];
  const den = all.every((v) => v % 10 === 0) ? 10 : all.every((v) => v % 5 === 0) ? 20 : 100;
  return ((hi0 - lo0) * den) / 100 <= MAX_PARTS ? { lo: lo0, hi: hi0, den } : null;
}

function compareItem(level: number, rng: Rng): ReturnType<GeneratorDef['generate']> {
  const { value, level: lv } = pickByLevel(
    rng,
    level,
    (r): DCmp => {
      for (;;) {
        const kind = r.int(0, 3);
        const w = r.chance(0.6) ? 0 : r.int(1, 5);
        let x: number;
        let y: number;
        if (kind === 0) {
          x = 100 * w + 10 * r.int(1, 9);
          y = 100 * w + 10 * r.int(1, 9);
        } else if (kind === 1) {
          const t = r.int(0, 9);
          x = 100 * w + 10 * t + r.int(1, 9);
          y = 100 * w + 10 * t + r.int(1, 9);
        } else if (kind === 2) {
          // A tenth against hundredths just below or above it: 0,5 vs 0,45; 0,3 vs 0,38.
          x = 100 * w + 10 * r.int(1, 9);
          y = x + (r.chance(0.5) ? -1 : 1) * r.int(1, 9);
        } else {
          // A tenth against a nearby x,x5: 0,3 vs 0,45 (window in twentieths).
          x = 100 * w + 10 * r.int(1, 9);
          y = 100 * w + 10 * r.int(0, 9) + 5;
        }
        if (x === y || x <= 0 || y <= 0 || !compareWindow(x, y, kind)) continue;
        const [a, b] = r.chance(0.5) ? [x, y] : [y, x];
        return { x: a, y: b, kind, pick: r.chance(0.7) ? 'max' : 'min' };
      }
    },
    (v) => {
      const longerSmaller = places(v.x) !== places(v.y) && (places(v.x) > places(v.y) ? v.x < v.y : v.y < v.x);
      return (
        [0.05, 0.25, 0.55, 0.45][v.kind]! +
        (v.kind === 2 && longerSmaller ? 0.15 : 0) +
        (v.x >= 100 ? 0.1 : 0) +
        (v.pick === 'min' ? 0.08 : 0)
      );
    },
  );
  const { x, y, kind, pick } = value;
  const { lo, hi, den } = compareWindow(x, y, kind)!;
  const big = Math.max(x, y);
  const small = Math.min(x, y);
  const right = pick === 'max' ? big : small;
  const wrong = pick === 'max' ? small : big;
  const tenthsOnly = x % 10 === 0 && y % 10 === 0;
  // The belief that would choose the wrong one: "longer is larger" picks the longer as the bigger
  // (or the shorter as the smaller); "shorter is larger" the reverse.
  let code: string | null = null;
  if (places(wrong) !== places(right)) {
    const wrongLonger = places(wrong) > places(right);
    code = wrongLonger === (pick === 'max') ? 'frac.dec.longerIsLarger' : 'frac.dec.shorterIsLarger';
  }
  const kLo = (lo * den) / 100;
  return {
    level: lv,
    prompt: { kind: 'compare', a: num(x / 100), b: num(y / 100), pick },
    answer: { value: rat(right, 100) },
    line: {
      min: lo / 100, max: hi / 100, start: lo / 100,
      major: den === 100 ? 5 / den : den === 20 ? 2 / den : 5 / den,
      minor: 1 / den, labelEvery: (hi - lo) / 100, steps: [1 / den],
      answerMode: 'land', den, labelStyle: 'decimal', pick: 'tap',
    },
    solution: [
      { k: 'hop', from: kLo / den, to: (right * den) / 100 / den },
      ...(tenthsOnly ? [] : [{ k: 'say', key: 'sol.frac.decPlaces', params: {} } satisfies SolutionStep]),
      tenthsOnly
        ? { k: 'say', key: 'sol.frac.decTenths', params: { a: x / 100, an: x / 10, b: y / 100, bn: y / 10 } }
        : { k: 'say', key: 'sol.frac.decHundredths', params: { a: x / 100, an: x, b: y / 100, bn: y } },
      pick === 'max'
        ? { k: 'say', key: 'sol.frac.decBigger', params: { a: big / 100, b: small / 100 } }
        : { k: 'say', key: 'sol.frac.decSmaller', params: { a: small / 100, b: big / 100 } },
    ],
    misconceptions: code ? uniqMisconceptions([{ value: wrong / 100, code }], right / 100) : [],
    features: { x, y, kind, den, max: pick === 'max' ? 1 : 0 },
  };
}

export const decLineGen: GeneratorDef<DecLineConfig> = {
  id: 'decLine',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng, cfg) {
    return cfg.mode === 'tenths' ? tenthsItem(level, rng) : compareItem(level, rng);
  },
};

// ── d.addsub: typed; worked as whole hops, then tenths, then hundredths ──
interface DAdd {
  /** Hundredths. */
  a: number;
  b: number;
  op: '+' | '-';
}

function decimalOf(r: Rng, dp: number, maxWhole: number): number {
  const whole = r.int(0, maxWhole);
  if (dp === 0) return 100 * Math.max(1, whole);
  const t = r.int(dp === 1 ? 1 : 0, 9);
  return 100 * whole + 10 * t + (dp === 2 ? r.int(1, 9) : 0);
}

export const decAddSubGen: GeneratorDef<Record<string, never>> = {
  id: 'decAddSub',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng) {
    const { value, level: lv } = pickByLevel(
      rng,
      level,
      (r): DAdd => {
        for (;;) {
          const op = r.chance(0.55) ? '+' : '-';
          let a = decimalOf(r, r.pick([0, 1, 1, 2, 2]), 9);
          let b = decimalOf(r, r.int(1, 2), 4);
          if (op === '-' && a < b) [a, b] = [b, a];
          if (op === '-' && a === b) continue;
          return { a, b, op };
        }
      },
      ({ a, b, op }) => {
        const mixed = places(a) !== places(b);
        const regroups = op === '+' ? carries(a, b) : borrows(a, b).count;
        return (
          0.05 +
          (mixed ? 0.25 : 0) +
          (places(a) === 2 && places(b) === 2 ? 0.08 : 0) +
          0.14 * Math.min(3, regroups) +
          (op === '-' ? 0.15 : 0) +
          (op === '-' && borrows(a, b).acrossZero ? 0.1 : 0) +
          (a >= 100 && b >= 100 ? 0.06 : 0)
        );
      },
    );
    const { a, b, op } = value;
    const plus = op === '+';
    const r = plus ? a + b : a - b;
    const den = [a, b, r].every((v) => v % 10 === 0) ? 10 : 100;
    const lo = Math.floor(Math.min(a, r) / 100);
    const hi = Math.max(lo + 1, Math.ceil(Math.max(a, r) / 100));

    // Split b into whole, tenths and hundredths; hop each part from a.
    // (Written as a sum, never a list: in Macedonian "1, 0,4 и 0,05" would read as nonsense.)
    const parts = [Math.floor(b / 100) * 100, Math.floor((b % 100) / 10) * 10, b % 10].filter((p) => p > 0);
    const solution: SolutionStep[] = [];
    if (parts.length === 3) solution.push({ k: 'say', key: 'sol.frac.decSplit3', params: { b: b / 100, p1: parts[0]! / 100, p2: parts[1]! / 100, p3: parts[2]! / 100 } });
    else if (parts.length === 2) solution.push({ k: 'say', key: 'sol.frac.decSplit2', params: { b: b / 100, p1: parts[0]! / 100, p2: parts[1]! / 100 } });
    let pos = a;
    for (const p of parts) {
      const next = plus ? pos + p : pos - p;
      solution.push({ k: 'hop', from: pos / 100, to: next / 100 });
      solution.push({ k: 'say', key: 'sol.step', params: { a: pos / 100, op, b: p / 100, r: next / 100 } });
      pos = next;
    }

    const mis: Array<{ value: number; code: string }> = [];
    // Lined up the last digits: 2,35 + 1,4 → 2,35 + 0,14.
    if (places(a) !== places(b)) {
      // The shorter number's digits slide right into the other's last places (3 → 0,03 under 1,25).
      const shift = (v: number, other: number): number => v / 10 ** (places(other) - places(v));
      const [a2, b2] = places(a) < places(b) ? [shift(a, b), b] : [a, shift(b, a)];
      const m = plus ? a2 + b2 : a2 - b2;
      if (Number.isInteger(m) && m >= 0) mis.push({ value: m / 100, code: 'frac.dec.misaligned' });
    }
    // 0,7 + 0,5 → 0,12: twelve tenths written as hundredths.
    if (plus && places(a) === 1 && places(b) === 1 && ((a % 100) + (b % 100)) >= 100) {
      const wrongH = (Math.floor(a / 100) + Math.floor(b / 100)) * 100 + ((a % 100) + (b % 100)) / 10;
      mis.push({ value: wrongH / 100, code: 'frac.dec.tenthsAsHundredths' });
    }
    if (!plus && places(a) === places(b)) mis.push({ value: subSmallerFromLarger(a, b) / 100, code: 'sub.smaller_from_larger' });
    return {
      level: lv,
      prompt: { kind: 'expr', expr: bin(op, a / 100, b / 100) },
      answer: { value: rat(r, 100) },
      line: {
        min: lo, max: hi, start: a / 100, major: 1, minor: 1 / 10, labelEvery: 1,
        steps: den === 10 ? [1, 1 / 10] : [1, 1 / 10, 1 / 100],
        answerMode: 'land', den, labelStyle: 'decimal',
      },
      solution,
      misconceptions: uniqMisconceptions(mis.filter((m) => m.value >= 0), r / 100),
      features: { a, b, r, mixed: places(a) !== places(b) ? 1 : 0, regroups: plus ? carries(a, b) : borrows(a, b).count },
    };
  },
};

// ── d.percent: "25 % of 80" on a double number line ──────────────────────
const PCTS = [50, 10, 25, 20, 30, 40, 60, 70, 80, 90, 75, 5, 15, 35, 45, 55, 65, 85, 95];

/** Half and tenth are the anchors; then quarters and whole tens; then the 5 % steps (more hops: harder). */
function pctCost(pct: number): number {
  if (pct === 50) return 0.05;
  if (pct === 10) return 0.1;
  if (pct === 25) return 0.25;
  if (pct % 10 === 0) return pct < 50 ? 0.3 : 0.35;
  if (pct === 75 || pct === 5) return 0.45;
  return pct < 50 ? 0.6 : 0.68;
}

export const percentOfGen: GeneratorDef<Record<string, never>> = {
  id: 'percentOf',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng) {
    const { value, level: lv } = pickByLevel(
      rng,
      level,
      (r) => {
        for (;;) {
          const pct = r.pick(PCTS);
          const of = 10 * r.int(1, 20);
          if ((pct * of) % 100 === 0) return { pct, of };
        }
      },
      ({ pct, of }) => pctCost(pct) + 0.2 * (of / 200) + (of % 20 !== 0 ? 0.08 : 0) + (of % 100 === 0 ? -0.05 : 0),
    );
    const { pct, of } = value;
    const r = (pct * of) / 100;
    const ten = of / 10;
    const tens = Math.floor(pct / 10);
    const den = of % 20 === 0 ? 1 : 2;
    const solution: SolutionStep[] = [];
    for (let k = 0; k < tens; k++) solution.push({ k: 'hop', from: (k * of) / 10, to: ((k + 1) * of) / 10 });
    if (pct % 10) solution.push({ k: 'hop', from: (tens * of) / 10, to: r });
    // Every number printed is a param (p: 10 too), so a hint never shows 10 when the answer is 10.
    solution.push({ k: 'say', key: 'sol.frac.pctTen', params: { p: 10, of, ten } });
    if (pct === 50) solution.push({ k: 'say', key: 'sol.frac.pctHalf', params: { of, op: '/', r } });
    else if (pct === 25) solution.push({ k: 'say', key: 'sol.frac.pctQuarter', params: { of, op: '/', r } });
    else if (pct === 75) solution.push({ k: 'say', key: 'sol.frac.pctThreeQuarters', params: { of, op: '/', q: of / 4, r } });
    else if (pct % 10 === 0) solution.push({ k: 'say', key: 'sol.frac.pctHops', params: { pct, n: tens, r } });
    else if (pct === 5) solution.push({ k: 'say', key: 'sol.frac.pctFive', params: { ten, r } });
    else solution.push({ k: 'say', key: 'sol.frac.pctHopsHalf', params: { pct, n: tens, r } });
    return {
      level: lv,
      prompt: { kind: 'percentOf', pct, of },
      answer: { value: rat(r) },
      line: {
        min: 0, max: of, start: 0, major: of / 10, minor: of / 20, labelEvery: of, steps: [of / 10, of / 20],
        answerMode: 'land', den, labelStyle: 'percent',
      },
      solution,
      misconceptions: uniqMisconceptions(
        [
          // "25 % of 80 is 25."
          { value: pct, code: 'frac.pct.asNumber' },
          // "80 : 25"
          { value: of / pct, code: 'frac.pct.dividedBy' },
        ],
        r,
      ),
      features: { pct, of },
    };
  },
};
