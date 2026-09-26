/** Counting, subitising, number-line placement and place-value (base-ten blocks). */
import { rat } from '../../rational';
import type { GeneratorDef, LineSpec, SolutionStep } from '../types';
import { clamp01, ones, pickByLevel, tens, uniqMisconceptions } from '../util';

type Layout = 'dice' | 'frame' | 'scatter';

export const countGen: GeneratorDef<{ max: number; layouts: Layout[] }> = {
  id: 'count',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng, cfg) {
    const layoutCost: Record<Layout, number> = { dice: 0, frame: 0.1, scatter: 0.3 };
    const { value, level: lv } = pickByLevel(
      rng,
      level,
      (r) => ({ n: r.int(1, cfg.max), layout: r.pick(cfg.layouts) }),
      ({ n, layout }) => {
        if (layout === 'dice' && n > 6) return 9; // dice patterns stop at 6: reject
        // Subitising range (≤4) is easy regardless of layout; beyond it, layout matters.
        return 0.7 * ((n - 1) / Math.max(1, cfg.max - 1)) + (n > 4 ? layoutCost[layout] : 0);
      },
    );
    const { n, layout } = value;
    const max = cfg.max <= 10 ? 10 : 20;
    const line: LineSpec = { min: 0, max, start: 0, major: 5, minor: 1, labelEvery: max <= 10 ? 1 : 5, steps: [1], answerMode: 'land' };
    return {
      level: lv,
      prompt: { kind: 'count', count: n, layout: layout === 'dice' && n > 6 ? 'frame' : layout },
      answer: { value: rat(n) },
      line,
      solution: [{ k: 'hop', from: 0, to: n }, { k: 'say', key: 'sol.count', params: { n } }],
      misconceptions: uniqMisconceptions(
        [
          { value: n + 1, code: 'count.off_by_one' },
          { value: n - 1, code: 'count.off_by_one' },
        ],
        n,
      ),
      features: { n, layout: ['dice', 'frame', 'scatter'].indexOf(layout) },
    };
  },
};

export const locateGen: GeneratorDef<{ min: number; max: number; tolerancePct?: number }> = {
  id: 'locate',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng, cfg) {
    const range = cfg.max - cfg.min;
    const score = (t: number): number => {
      if (cfg.min < 0) return 0.15 + (t < 0 ? 0.45 : 0) + 0.025 * Math.abs(t);
      if (range <= 20) {
        const dAnchor = Math.min(t % 5, 5 - (t % 5));
        return 0.1 + 0.2 * dAnchor + 0.3 * (t / range);
      }
      if (range <= 100) {
        const u = t % 10;
        return 0.1 + 0.1 * Math.min(u, 10 - u) + 0.25 * (t / 100);
      }
      if (t % 100 === 0) return 0.1;
      if (t % 50 === 0) return 0.3;
      if (t % 10 === 0) return 0.55;
      return 0.8 + 0.15 * (1 - Math.abs(t - 500) / 500);
    };
    const { value: t, level: lv } = pickByLevel(rng, level, (r) => {
      let v = r.int(cfg.min, cfg.max);
      if (cfg.min < 0 && v === 0) v = r.int(1, cfg.max);
      if (cfg.min >= 0 && v === 0) v = r.int(1, cfg.max);
      return v;
    }, score);

    let line: LineSpec;
    const solution: SolutionStep[] = [];
    if (cfg.min < 0) {
      line = { min: cfg.min, max: cfg.max, start: 0, major: 5, minor: 1, labelEvery: 5, steps: [1], answerMode: 'land' };
      solution.push({ k: 'hop', from: 0, to: t }, { k: 'say', key: 'sol.locateNeg', params: { t, n: Math.abs(t), dir: t < 0 ? 'left' : 'right' } });
    } else if (range <= 20) {
      line = { min: 0, max: cfg.max, start: 0, major: 5, minor: 1, labelEvery: range <= 10 ? 1 : 5, steps: [1], answerMode: 'land' };
      solution.push({ k: 'hop', from: 0, to: t });
    } else if (range <= 100) {
      line = { min: 0, max: 100, start: 0, major: 10, minor: 5, labelEvery: 10, steps: [10, 1], answerMode: 'land' };
      for (let i = 0; i < tens(t); i++) solution.push({ k: 'hop', from: i * 10, to: (i + 1) * 10 });
      if (t === 100) solution.push({ k: 'hop', from: 90, to: 100 });
      else if (ones(t)) solution.push({ k: 'hop', from: tens(t) * 10, to: t });
      solution.push({ k: 'say', key: 'sol.locateTens', params: { t, tens: Math.floor(t / 10), ones: t % 10 } });
    } else {
      line = { min: 0, max: cfg.max, start: 0, major: 100, minor: 10, labelEvery: 100, steps: [100, 10, 1], answerMode: 'land' };
      const h = Math.floor(t / 100);
      for (let i = 0; i < h; i++) solution.push({ k: 'hop', from: i * 100, to: (i + 1) * 100 });
      if (t % 100) solution.push({ k: 'hop', from: h * 100, to: t });
      solution.push({ k: 'say', key: 'sol.locateHundreds', params: { t, h: h * 100, rest: t % 100 } });
    }

    const reversed = t >= 10 && t < 100 && ones(t) !== 0 ? ones(t) * 10 + tens(t) : NaN;
    return {
      level: lv,
      prompt: { kind: 'locate', target: t },
      answer: cfg.tolerancePct ? { value: rat(t), tolerance: Math.round(cfg.tolerancePct * range) } : { value: rat(t) },
      line,
      solution,
      misconceptions: uniqMisconceptions(
        [
          { value: reversed, code: 'pv.reversal' },
          { value: cfg.min < 0 ? -t : NaN, code: 'int.sign_error' },
        ],
        t,
      ),
      features: { t, range },
    };
  },
};

export const blocksGen: GeneratorDef<{ max: number }> = {
  id: 'blocks',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng, cfg) {
    const big = cfg.max > 100;
    const { value, level: lv } = pickByLevel(
      rng,
      level,
      (r) => {
        const nonCanonical = r.chance(0.25);
        const h = big ? r.int(1, 9) : 0;
        let t = r.int(big ? 0 : 1, 9);
        let o = r.int(0, 9);
        if (nonCanonical) {
          // e.g. "2 tens and 14 ones": does the child regroup?
          if (big && r.chance(0.5)) {
            t = r.int(10, 14);
            return { h: Math.min(h, 8), t, o };
          } else {
            o = r.int(10, 16);
            if (!big) t = Math.min(t, 7); // stay within 0–100
          }
        }
        return { h, t, o };
      },
      ({ h, t, o }) => {
        const nonCanonical = t > 9 || o > 9;
        const internalZero = big && t === 0 && o !== 0;
        return 0.1 + 0.03 * t + 0.03 * Math.min(o, 9) + (big ? 0.1 : 0) + (internalZero ? 0.2 : 0) + (nonCanonical ? 0.4 : 0);
      },
    );
    const { h, t, o } = value;
    const v = h * 100 + t * 10 + o;
    const solution: SolutionStep[] = [];
    let pos = 0;
    for (let i = 0; i < h; i++, pos += 100) solution.push({ k: 'hop', from: pos, to: pos + 100 });
    for (let i = 0; i < t; i++, pos += 10) solution.push({ k: 'hop', from: pos, to: pos + 10 });
    if (o) solution.push({ k: 'hop', from: pos, to: pos + o });
    solution.push({ k: 'say', key: big ? 'sol.blocks3' : 'sol.blocks2', params: { h, t, o, value: v } });
    const concat = Number(`${h || ''}${t}${o}`);
    return {
      level: lv,
      prompt: { kind: 'blocks', hundreds: h, tens: t, ones: o },
      answer: { value: rat(v) },
      line: big
        ? { min: 0, max: 1000, start: 0, major: 100, minor: 10, labelEvery: 100, steps: [100, 10, 1], answerMode: 'land' }
        : { min: 0, max: 100, start: 0, major: 10, minor: 5, labelEvery: 10, steps: [10, 1], answerMode: 'land' },
      solution,
      misconceptions: uniqMisconceptions(
        [
          { value: concat, code: 'pv.concat' },
          { value: big && t === 0 ? h * 10 + o : NaN, code: 'pv.missing_zero' },
          { value: h * 100 + o * 10 + t, code: 'pv.reversal' },
        ],
        v,
      ),
      features: { h, t, o, nonCanonical: t > 9 || o > 9 ? 1 : 0 },
    };
  },
};

export const bondsGen: GeneratorDef<{ total: number }> = {
  id: 'bonds',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng, cfg) {
    const total = cfg.total;
    const { value: a, level: lv } = pickByLevel(
      rng,
      level,
      (r) => r.int(0, total - 1),
      (a) => {
        const b = total - a;
        return clamp01(0.12 + 0.13 * Math.min(b, 6) - (a === b ? 0.15 : 0) + (b > a ? 0.1 : 0) + (total > 5 ? 0.1 : 0));
      },
    );
    const b = total - a;
    return {
      level: lv,
      prompt: { kind: 'expr', expr: { k: 'op', op: '+', a: { k: 'num', v: a }, b: { k: 'blank' } }, rhs: { k: 'num', v: total } },
      answer: { value: rat(b) },
      line: { min: 0, max: 10, start: a, flag: total, major: 5, minor: 1, labelEvery: 1, steps: [1], answerMode: 'count', hopSize: 1 },
      solution: [{ k: 'hop', from: a, to: total }, { k: 'say', key: 'sol.bond', params: { a, b, total } }],
      misconceptions: uniqMisconceptions(
        [
          { value: total, code: 'bonds.gave_total' },
          { value: a, code: 'bonds.echo' },
          { value: b + 1, code: 'count.off_by_one' },
          { value: b - 1, code: 'count.off_by_one' },
        ],
        b,
      ),
      features: { a, b, total },
    };
  },
};
