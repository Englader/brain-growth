/**
 * Addition and subtraction from "within 10" to multi-digit with regrouping.
 * One parameterised generator covers five curriculum stages; the config picks
 * the stage, the level picks the item within it.
 *
 * Worked solutions use number-line strategies taught in early grades:
 * make-ten / back-through-ten within 20, jumps of ten within 100, and
 * place-value splitting beyond. The same hops drive the feedback animation.
 */
import { rat } from '../../rational';
import type { Rng } from '../../rng';
import type { GeneratedItem, GeneratorDef, LineSpec, SolutionStep } from '../types';
import {
  addNoCarry,
  bin,
  borrows,
  carries,
  clamp01,
  ones,
  pickByLevel,
  subBorrowNoDecrement,
  subSmallerFromLarger,
  uniqMisconceptions,
  windowAround,
} from '../util';

export interface AddSubConfig {
  op: '+' | '-';
  range: 10 | 20 | 100 | 1000;
  regroup?: 'never' | 'required';
}

interface Pair {
  a: number;
  b: number;
}

function sampler(cfg: AddSubConfig): (r: Rng) => Pair | null {
  const { op, range, regroup } = cfg;
  if (op === '+') {
    switch (range) {
      case 10:
        return (r) => {
          const a = r.int(0, 9);
          return { a, b: r.int(1, 10 - a) };
        };
      case 20:
        return (r) => {
          const a = r.int(1, 19);
          return { a, b: r.int(1, Math.min(10, 20 - a)) };
        };
      case 100:
        return (r) => {
          const a = r.int(10, 89);
          const b = r.chance(0.35) ? r.int(1, 9) : r.int(10, 99 - a);
          if (b < 1 || a + b > 100) return null;
          const carry = ones(a) + ones(b) >= 10;
          if (regroup === 'never' && carry) return null;
          if (regroup === 'required' && !carry) return null;
          return { a, b };
        };
      case 1000:
        return (r) => {
          const a = r.int(100, 899);
          const b = r.chance(0.3) ? r.int(10, 99) : r.int(100, 999 - a);
          return b >= 10 && a + b <= 999 ? { a, b } : null;
        };
    }
  }
  switch (range) {
    case 10:
      return (r) => {
        const a = r.int(1, 10);
        return { a, b: r.int(1, a) };
      };
    case 20:
      return (r) => {
        const a = r.int(2, 20);
        return { a, b: r.int(1, Math.min(a, 10)) };
      };
    case 100:
      return (r) => {
        const a = r.int(20, 100);
        const b = r.chance(0.35) ? r.int(1, 9) : r.int(10, a - 1);
        if (b < 1 || b >= a) return null;
        const borrow = ones(a) < ones(b);
        if (regroup === 'never' && borrow) return null;
        if (regroup === 'required' && !borrow) return null;
        return { a, b };
      };
    case 1000:
      return (r) => {
        const a = r.int(200, 999);
        const b = r.chance(0.3) ? r.int(10, 99) : r.int(100, a - 1);
        return b >= 10 && b < a ? { a, b } : null;
      };
  }
}

function score(cfg: AddSubConfig, { a, b }: Pair): number {
  const { op, range, regroup } = cfg;
  const small = Math.min(a, b) <= 2 ? 1 : 0;
  if (op === '+') {
    const s = a + b;
    switch (range) {
      case 10:
        return 0.02 + 0.09 * (s - 1) - 0.25 * (Math.min(a, b) <= 1 ? 1 : 0) - 0.1 * (a === b ? 1 : 0) + 0.08 * (b > a ? 1 : 0);
      case 20: {
        const bridge = a < 10 && s > 10 ? 1 : 0;
        return 0.12 + 0.36 * bridge + 0.025 * Math.max(0, s - 5) - 0.15 * (a === b ? 1 : 0) - 0.2 * small + 0.06 * (b > a ? 1 : 0);
      }
      case 100: {
        const twoByTwo = b >= 10 && b % 10 !== 0 ? 1 : 0;
        const round = b % 10 === 0 ? 1 : 0;
        return (regroup === 'required' ? 0.22 : 0.08) + 0.38 * twoByTwo - 0.05 * round + 0.004 * s + (s === 100 ? 0.08 : 0);
      }
      case 1000:
        return 0.05 + 0.2 * (b >= 100 ? 1 : 0) + 0.24 * carries(a, b) + 0.08 * (s >= 900 ? 1 : 0);
    }
  }
  const d = a - b;
  switch (range) {
    case 10:
      return 0.02 + 0.085 * a - 0.25 * (b <= 1 ? 1 : 0) - 0.15 * (b === a || d <= 1 ? 1 : 0) + 0.05 * (b > d ? 1 : 0);
    case 20: {
      const bridge = a > 10 && ones(a) < b ? 1 : 0;
      return 0.1 + 0.4 * bridge + 0.022 * a - 0.2 * (b <= 2 ? 1 : 0);
    }
    case 100: {
      const twoByTwo = b >= 10 && b % 10 !== 0 ? 1 : 0;
      return (regroup === 'required' ? 0.25 : 0.08) + 0.36 * twoByTwo + 0.003 * a - 0.05 * (b % 10 === 0 ? 1 : 0);
    }
    case 1000: {
      const br = borrows(a, b);
      return 0.05 + 0.18 * (b >= 100 ? 1 : 0) + 0.22 * br.count + 0.25 * (br.acrossZero ? 1 : 0);
    }
  }
}

function lineFor(cfg: AddSubConfig, a: number, r: number): LineSpec {
  const answerMode = 'land' as const;
  switch (cfg.range) {
    case 10:
      return { min: 0, max: 10, start: a, major: 5, minor: 1, labelEvery: 1, steps: [1], answerMode };
    case 20:
      return { min: 0, max: 20, start: a, major: 5, minor: 1, labelEvery: 5, steps: [1], answerMode };
    case 100:
      return { min: 0, max: 100, start: a, major: 10, minor: 5, labelEvery: 10, steps: [10, 1], answerMode };
    case 1000: {
      const [min, max] = windowAround([a, r], 100, 300);
      return { min, max, start: a, major: 100, minor: 10, labelEvery: 100, steps: [100, 10, 1], answerMode };
    }
  }
}

/** Jumps of ten, then ones — splitting the ones at the next ten ("47 → 67 → 70 → 72"). */
function tensThenOnes(a: number, b: number, dir: 1 | -1): SolutionStep[] {
  const steps: SolutionStep[] = [];
  let pos = a;
  for (let i = 0; i < Math.floor(b / 10); i++) {
    steps.push({ k: 'hop', from: pos, to: pos + dir * 10 });
    pos += dir * 10;
  }
  const o = b % 10;
  if (o) {
    const toTen = dir > 0 ? (10 - ones(pos)) % 10 : ones(pos);
    if (toTen > 0 && toTen < o) {
      steps.push({ k: 'hop', from: pos, to: pos + dir * toTen });
      pos += dir * toTen;
      steps.push({ k: 'hop', from: pos, to: pos + dir * (o - toTen) });
    } else steps.push({ k: 'hop', from: pos, to: pos + dir * o });
  }
  return steps;
}

function solve(cfg: AddSubConfig, a: number, b: number): SolutionStep[] {
  const plus = cfg.op === '+';
  const r = plus ? a + b : a - b;
  const op = cfg.op;
  if (cfg.range <= 20) {
    if (plus && a < 10 && r > 10) {
      return [
        { k: 'hop', from: a, to: 10 },
        { k: 'hop', from: 10, to: r },
        { k: 'say', key: 'sol.makeTen', params: { a, b, toTen: 10 - a, rest: r - 10, r } },
      ];
    }
    if (!plus && a > 10 && ones(a) < b) {
      return [
        { k: 'hop', from: a, to: 10 },
        { k: 'hop', from: 10, to: r },
        { k: 'say', key: 'sol.backThroughTen', params: { a, b, toTen: a - 10, rest: b - (a - 10), r } },
      ];
    }
    return [{ k: 'hop', from: a, to: r }, { k: 'say', key: plus ? 'sol.countOn' : 'sol.countBack', params: { a, b, r } }];
  }
  if (cfg.range === 100) {
    const t = Math.floor(b / 10) * 10;
    const o = b % 10;
    const says: SolutionStep[] = [];
    if (t && o) {
      const mid = plus ? a + t : a - t;
      says.push(
        { k: 'say', key: 'sol.split2', params: { b, t, o } },
        { k: 'say', key: 'sol.step', params: { a, op, b: t, r: mid } },
        { k: 'say', key: 'sol.step', params: { a: mid, op, b: o, r } },
      );
    } else says.push({ k: 'say', key: 'sol.step', params: { a, op, b, r } });
    return [...tensThenOnes(a, b, plus ? 1 : -1), ...says];
  }
  // range 1000: split b into hundreds, tens, ones.
  const h = Math.floor(b / 100) * 100;
  const t = Math.floor((b % 100) / 10) * 10;
  const o = b % 10;
  const parts = [h, t, o].filter((x) => x > 0);
  const steps: SolutionStep[] = [];
  steps.push(
    parts.length === 3
      ? { k: 'say', key: 'sol.split3', params: { b, h, t, o } }
      : parts.length === 2
        ? { k: 'say', key: 'sol.split2', params: { b, t: parts[0]!, o: parts[1]! } }
        : { k: 'say', key: 'sol.step', params: { a, op, b, r } },
  );
  let pos = a;
  for (const p of parts) {
    const next = plus ? pos + p : pos - p;
    steps.push({ k: 'hop', from: pos, to: next });
    if (parts.length > 1) steps.push({ k: 'say', key: 'sol.step', params: { a: pos, op, b: p, r: next } });
    pos = next;
  }
  return steps;
}

/** The item for a chosen pair (shared by sampling and fixed operands). */
function build(cfg: AddSubConfig, { a, b }: Pair, level: number, line: LineSpec): GeneratedItem {
  const plus = cfg.op === '+';
  const r = plus ? a + b : a - b;
  const mis: Array<{ value: number; code: string }> = [];
  if (plus) {
    if (cfg.range <= 20) {
      mis.push({ value: r - 1, code: 'count.off_by_one' }, { value: r + 1, code: 'count.off_by_one' });
      if (a < 10 && r > 10) mis.push({ value: r - 10, code: 'add.dropped_ten' });
    } else {
      mis.push({ value: addNoCarry(a, b), code: 'add.no_carry' });
      const onesSum = ones(a) + ones(b);
      if (onesSum >= 10 && a < 100 && b < 100) {
        mis.push({ value: (Math.floor(a / 10) + Math.floor(b / 10)) * 100 + onesSum, code: 'add.carry_concat' });
      }
      mis.push({ value: r + 10, code: 'add.tens_slip' }, { value: r - 10, code: 'add.tens_slip' });
    }
  } else {
    mis.push({ value: a + b, code: 'sub.added' });
    if (cfg.range <= 20) {
      mis.push({ value: r + 1, code: 'sub.count_includes_start' }, { value: r - 1, code: 'count.off_by_one' });
      if (a > 10 && ones(a) < b) mis.push({ value: subSmallerFromLarger(a, b), code: 'sub.smaller_from_larger' });
    } else {
      mis.push(
        { value: subSmallerFromLarger(a, b), code: 'sub.smaller_from_larger' },
        { value: subBorrowNoDecrement(a, b), code: 'sub.borrow_no_decrement' },
      );
    }
  }
  return {
    level,
    prompt: { kind: 'expr', expr: bin(cfg.op, a, b) },
    answer: { value: rat(r) },
    line,
    solution: solve(cfg, a, b),
    misconceptions: uniqMisconceptions(mis.filter((m) => m.value >= 0), r),
    features: {
      a,
      b,
      r,
      carries: plus ? carries(a, b) : 0,
      borrows: plus ? 0 : borrows(a, b).count,
      acrossZero: plus ? 0 : borrows(a, b).acrossZero ? 1 : 0,
    },
  };
}

const RANGES: ReadonlyArray<AddSubConfig['range']> = [10, 20, 100, 1000];

export const addSubGen: GeneratorDef<AddSubConfig> = {
  id: 'addsub',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng, cfg) {
    const sample = sampler(cfg);
    const { value, level: lv } = pickByLevel(
      rng,
      level,
      (r) => {
        for (let i = 0; i < 200; i++) {
          const p = sample(r);
          if (p) return p;
        }
        throw new Error(`addsub sampler exhausted for ${JSON.stringify(cfg)}`);
      },
      (p) => clamp01(score(cfg, p)),
    );
    const r = cfg.op === '+' ? value.a + value.b : value.a - value.b;
    return build(cfg, value, lv, lineFor(cfg, value.a, r));
  },
  fromOperands({ a, op, b }, cfg) {
    if (op !== cfg.op || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 1) return null;
    const r = op === '+' ? a + b : a - b;
    if (r < 0) return null;
    // Same scorer as sampling; the line is the config's, widened when the operands run past it.
    const range = RANGES.find((x) => x >= cfg.range && Math.max(a, r) <= x) ?? 1000;
    return build(cfg, { a, b }, clamp01(score(cfg, { a, b })), lineFor({ ...cfg, range }, a, r));
  },
};
