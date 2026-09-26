/**
 * Multiplication and division, from equal groups (hops of equal size on the
 * number line) through the full tables to multi-digit products.
 *
 * Convention: "a × b" is drawn as `a` hops of size `b`. Table difficulty uses
 * the well-replicated problem-size / tie / 0-1-2-5-10 effects: ×0 ×1 ×2 ×10 ×5
 * are easy, squares easier than neighbours, 6·7·8 hardest.
 */
import { rat } from '../../rational';
import type { GeneratorDef, SolutionStep } from '../types';
import { bin, clamp01, pickByLevel, uniqMisconceptions, windowAround } from '../util';

const TABLE_EASE: Record<number, number> = {
  0: 0, 1: 0.05, 2: 0.12, 10: 0.12, 5: 0.22, 3: 0.4, 4: 0.45, 9: 0.55, 6: 0.7, 8: 0.8, 7: 0.85,
};

export function factDifficulty(a: number, b: number): number {
  const ea = TABLE_EASE[a] ?? 0.9;
  const eb = TABLE_EASE[b] ?? 0.9;
  return clamp01((0.65 * Math.max(ea, eb) + 0.35 * Math.min(ea, eb)) / 0.85 - (a === b && a > 2 ? 0.1 : 0));
}

function hopsOf(n: number, size: number, from = 0): SolutionStep[] {
  const steps: SolutionStep[] = [];
  for (let i = 0; i < n; i++) steps.push({ k: 'hop', from: from + i * size, to: from + (i + 1) * size });
  return steps;
}

/** Derived-fact strategies: ×9 via ×10, ×4 via doubling twice, big facts via 5 + rest. */
function factStrategy(a: number, b: number): SolutionStep[] {
  const p = a * b;
  if (a === 9 && b >= 2) {
    return [
      { k: 'say', key: 'sol.times9', params: { b } },
      { k: 'say', key: 'sol.step', params: { a: 10, op: '*', b, r: 10 * b } },
      { k: 'say', key: 'sol.step', params: { a: 10 * b, op: '-', b, r: p } },
    ];
  }
  if (a === 4 && b >= 3) {
    return [{ k: 'say', key: 'sol.doubleDouble', params: { b, d1: 2 * b, d2: p } }];
  }
  if (a >= 6 && b >= 3) {
    const rest = a - 5;
    return [
      { k: 'say', key: 'sol.fivePlus', params: { a, rest } },
      { k: 'say', key: 'sol.step', params: { a: 5, op: '*', b, r: 5 * b } },
      { k: 'say', key: 'sol.step', params: { a: rest, op: '*', b, r: rest * b } },
      { k: 'say', key: 'sol.step', params: { a: 5 * b, op: '+', b: rest * b, r: p } },
    ];
  }
  return [{ k: 'say', key: 'sol.repeatedAdd', params: { n: a, size: b, p } }];
}

export const groupsGen: GeneratorDef<{ maxGroups: number; maxSize: number }> = {
  id: 'groups',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng, cfg) {
    const { value, level: lv } = pickByLevel(
      rng,
      level,
      (r) => ({ n: r.int(2, cfg.maxGroups), size: r.int(2, cfg.maxSize) }),
      ({ n, size }) => 0.05 + 0.03 * n * size + 0.08 * (size === 3 || size === 4 ? 1 : 0) - 0.08 * (size === 2 ? 1 : 0),
    );
    const { n, size } = value;
    const p = n * size;
    return {
      level: lv,
      prompt: { kind: 'groups', groups: n, size },
      answer: { value: rat(p) },
      line: { min: 0, max: 30, start: 0, major: 5, minor: 1, labelEvery: 5, steps: [size], answerMode: 'land' },
      solution: [...hopsOf(n, size), { k: 'say', key: 'sol.repeatedAdd', params: { n, size, p } }],
      misconceptions: uniqMisconceptions(
        [
          { value: n + size, code: 'mul.added' },
          { value: p + size, code: 'mul.adjacent_fact' },
          { value: p - size, code: 'mul.adjacent_fact' },
        ],
        p,
      ),
      features: { n, size, p },
    };
  },
};

export const multGen: GeneratorDef<{ factors?: number[]; minFactor?: number }> = {
  id: 'mult',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng, cfg) {
    const lo = cfg.minFactor ?? 0;
    const { value, level: lv } = pickByLevel(
      rng,
      level,
      (r) => {
        let a = r.int(lo, 10);
        let b = r.int(Math.max(lo, 1), 10);
        if (cfg.factors?.length) {
          const f = r.pick(cfg.factors);
          if (r.chance(0.5)) a = f;
          else b = f;
        }
        return { a, b };
      },
      ({ a, b }) => factDifficulty(a, b),
    );
    const { a, b } = value;
    const p = a * b;
    return {
      level: lv,
      prompt: { kind: 'expr', expr: bin('*', a, b) },
      answer: { value: rat(p) },
      line: { min: 0, max: 100, start: 0, major: 10, minor: 5, labelEvery: 10, steps: [b], answerMode: 'land' },
      solution: [...hopsOf(a, b), ...factStrategy(a, b)],
      misconceptions: uniqMisconceptions(
        [
          { value: (a + 1) * b, code: 'mul.adjacent_fact' },
          { value: (a - 1) * b, code: 'mul.adjacent_fact' },
          { value: a * (b + 1), code: 'mul.adjacent_fact' },
          { value: a * (b - 1), code: 'mul.adjacent_fact' },
          { value: a + b, code: 'mul.added' },
        ].filter((m) => m.value >= 0),
        p,
      ),
      features: { a, b, p },
    };
  },
};

export const divGen: GeneratorDef<{ minFactor?: number }> = {
  id: 'div',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng, cfg) {
    const lo = Math.max(1, cfg.minFactor ?? 1);
    const { value, level: lv } = pickByLevel(
      rng,
      level,
      (r) => ({ q: r.int(lo, 10), d: r.int(Math.max(2, lo), 10) }),
      ({ q, d }) => clamp01(factDifficulty(q, d) + 0.08),
    );
    const { q, d } = value;
    const target = q * d;
    return {
      level: lv,
      prompt: { kind: 'expr', expr: bin('/', target, d) },
      answer: { value: rat(q) },
      line: {
        min: 0, max: 100, start: 0, flag: target, major: 10, minor: 5, labelEvery: 10,
        steps: [d], answerMode: 'count', hopSize: d,
      },
      solution: [...hopsOf(q, d), { k: 'say', key: 'sol.divAsHops', params: { n: q, size: d, target } }],
      misconceptions: uniqMisconceptions(
        [
          { value: target - d, code: 'div.subtracted' },
          { value: q + 1, code: 'div.off_by_one' },
          { value: q - 1, code: 'div.off_by_one' },
        ],
        q,
      ),
      features: { q, d, target },
    };
  },
};

export const mult10sGen: GeneratorDef<Record<string, never>> = {
  id: 'mult10s',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng) {
    type V = { a: number; b: number; a0: number; b0: number; z: number; variant: number };
    const { value, level: lv } = pickByLevel(
      rng,
      level,
      (r): V => {
        const variant = r.int(0, 3);
        const x = r.int(2, 9);
        const y = r.int(2, 9);
        switch (variant) {
          case 0: {
            const m = r.pick([10, 100]);
            const a = r.int(2, 99);
            return { a, b: m, a0: a, b0: 1, z: m === 10 ? 1 : 2, variant };
          }
          case 1:
            return { a: x * 10, b: y, a0: x, b0: y, z: 1, variant };
          case 2:
            return { a: x * 100, b: y, a0: x, b0: y, z: 2, variant };
          default:
            return { a: x * 10, b: y * 10, a0: x, b0: y, z: 2, variant };
        }
      },
      (v) => [0.08, 0.3, 0.42, 0.58][v.variant]! + (v.variant === 0 ? 0.002 * v.a : 0.4 * factDifficulty(v.a0, v.b0)),
    );
    const { a, b, a0, b0, z } = value;
    const p = a * b;
    const base = a0 * b0;
    const unit = 10 ** Math.max(1, String(p).length - 1);
    const [min, max] = windowAround([0, p], unit, unit * 3);
    return {
      level: lv,
      prompt: { kind: 'expr', expr: bin('*', a, b) },
      answer: { value: rat(p) },
      line: { min, max, start: 0, major: unit, minor: unit / 10, labelEvery: unit, steps: [unit], answerMode: 'land' },
      solution: [
        { k: 'hop', from: 0, to: p },
        b0 === 1
          ? ({ k: 'say', key: 'sol.timesTen', params: { a, b, z, r: p } } satisfies SolutionStep)
          : ({ k: 'say', key: 'sol.zeros', params: { a0, b0, base, z, r: p } } satisfies SolutionStep),
      ] as SolutionStep[],
      misconceptions: uniqMisconceptions(
        [
          { value: p / 10, code: 'mul.zeros' },
          { value: p * 10, code: 'mul.zeros' },
        ],
        p,
      ),
      features: { a, b, p, z },
    };
  },
};

export const multMultiGen: GeneratorDef<Record<string, never>> = {
  id: 'multMulti',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng) {
    type V = { a: number; b: number; kind: 0 | 1 | 2 };
    const { value, level: lv } = pickByLevel(
      rng,
      level,
      (r): V => {
        const kind = r.int(0, 2) as 0 | 1 | 2;
        if (kind === 0) return { a: r.int(11, 99), b: r.int(2, 9), kind };
        if (kind === 1) return { a: r.int(101, 999), b: r.int(2, 9), kind };
        return { a: r.int(11, 99), b: r.int(1, 9) * 10 + r.int(1, 9), kind };
      },
      ({ a, b, kind }) => {
        const carry = ((a % 10) * (b % 10)) >= 10 ? 1 : 0;
        if (kind === 0) return 0.05 + 0.2 * carry + 0.25 * factDifficulty(Math.floor(a / 10) % 10, b);
        if (kind === 1) return 0.4 + 0.12 * carry + 0.2 * factDifficulty(Math.floor(a / 100), b);
        return 0.65 + 0.3 * factDifficulty(a % 10, b % 10);
      },
    );
    const { a, b, kind } = value;
    const p = a * b;
    const steps: SolutionStep[] = [];
    let noCarry = NaN;
    if (kind !== 2) {
      // Split the multi-digit factor by place value (distributive law).
      const parts = String(a)
        .split('')
        .map((dgt, i, arr) => Number(dgt) * 10 ** (arr.length - 1 - i))
        .filter((x) => x > 0);
      if (parts.length === 3) steps.push({ k: 'say', key: 'sol.split3', params: { b: a, h: parts[0]!, t: parts[1]!, o: parts[2]! } });
      else if (parts.length === 2) steps.push({ k: 'say', key: 'sol.split2', params: { b: a, t: parts[0]!, o: parts[1]! } });
      let acc = 0;
      for (const part of parts) {
        steps.push({ k: 'say', key: 'sol.step', params: { a: part, op: '*', b, r: part * b } });
        steps.push({ k: 'hop', from: acc, to: acc + part * b });
        acc += part * b;
      }
      steps.push({ k: 'say', key: 'sol.addPartials', params: { r: p } });
      // Column multiplication that drops every carry: 34 × 6 → "18" "4" → 184.
      const ds = String(a).split('').map(Number);
      noCarry = Number(ds.map((dgt, i) => String(i === 0 ? dgt * b : (dgt * b) % 10)).join(''));
    } else {
      const bt = Math.floor(b / 10) * 10;
      const bo = b % 10;
      steps.push(
        { k: 'say', key: 'sol.split2', params: { b, t: bt, o: bo } },
        { k: 'say', key: 'sol.step', params: { a, op: '*', b: bt, r: a * bt } },
        { k: 'hop', from: 0, to: a * bt },
        { k: 'say', key: 'sol.step', params: { a, op: '*', b: bo, r: a * bo } },
        { k: 'hop', from: a * bt, to: p },
        { k: 'say', key: 'sol.step', params: { a: a * bt, op: '+', b: a * bo, r: p } },
      );
    }
    const unit = 10 ** Math.max(1, String(p).length - 1);
    const [min, max] = windowAround([0, p], unit, unit * 3);
    const partialsMissing = kind === 2 ? Math.floor(a / 10) * Math.floor(b / 10) * 100 + (a % 10) * (b % 10) : NaN;
    return {
      level: lv,
      prompt: { kind: 'expr', expr: bin('*', a, b) },
      answer: { value: rat(p) },
      line: { min, max, start: 0, major: unit, minor: unit / 10, labelEvery: unit, steps: [unit], answerMode: 'land' },
      solution: steps,
      misconceptions: uniqMisconceptions(
        [
          { value: noCarry, code: 'mul.no_carry' },
          { value: partialsMissing, code: 'mul.partial_products_missing' },
        ],
        p,
      ),
      features: { a, b, p, kind },
    };
  },
};
