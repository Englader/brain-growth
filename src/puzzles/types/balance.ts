/**
 * Balance / weighing (A–C): scales in balance, shapes of unknown integer weight.
 *
 * Every scale is an equation: (shapes and unit weights on the left pan) =
 * (shapes and unit weights on the right pan). Shape ids are abstract (`b0`…
 * `b5`); the UI draws each as a distinct shape. `units` are unit weights: cubes
 * to count in Band A (never more than 10 on a pan), a weight block showing the
 * number in Bands B/C.
 *
 * Band A: one or two scales; the child enters the weight of ONE shape (`ask`)
 * on pads 0–10. Bands B/C: two or three scales with two or three shapes; the
 * child enters the weight of EVERY shape, and the scales tilt with the entries.
 * The coefficient matrix always has full rank, so the solution is unique over
 * the reals, hence over the integers.
 *
 * Violated constraint ids: `scale:<i>` (scale i does not balance with the
 * entered weights), `shape:<id>` (an asked weight is missing or not an integer
 * in [0, max]). Focus ids in hints: `scale:<i>`, `shape:<id>`, `pan:<i>:left|right`.
 */
import { div, mul, rat, sub, type Rational } from '../../core/rational';
import type { Rng } from '../../core/rng';
import type { BandId } from '../../core/types';
import { fail, ok, type CheckResult, type PuzzleHint, type PuzzleTypeDef } from '../types';
import { assertBand, clamp01, isInt, pickByLevel, sampleUntil, uniqCanon } from '../util';

export const SHAPE_IDS = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'] as const;

export interface PanItem {
  shape: string;
  count: number;
}
export interface Pan {
  shapes: PanItem[];
  units: number;
}
export interface Scale {
  left: Pan;
  right: Pan;
}
export interface BalancePuzzle {
  /** Shape ids used (display order); `ask` and answer keys come from this list. */
  shapes: string[];
  scales: Scale[];
  /** Shapes whose weight the child enters (Band A: one; B/C: all). */
  ask: string[];
  /** Weights are integers in [0, max]. */
  max: number;
}
/** Weight per asked shape id. */
export type BalanceAnswer = Record<string, number>;

// ---------------------------------------------------------------- algebra

const panWeight = (pan: Pan, w: Record<string, number>): number =>
  pan.units + pan.shapes.reduce((s, it) => s + it.count * (w[it.shape] ?? 0), 0);

export const balances = (sc: Scale, w: Record<string, number>): boolean => panWeight(sc.left, w) === panWeight(sc.right, w);

/** Row form: Σ coef[s]·w[s] = rhs. */
function row(sc: Scale, shapes: readonly string[]): { coef: number[]; rhs: number } {
  const coef = shapes.map(
    (s) =>
      sc.left.shapes.filter((i) => i.shape === s).reduce((a, i) => a + i.count, 0) -
      sc.right.shapes.filter((i) => i.shape === s).reduce((a, i) => a + i.count, 0),
  );
  return { coef, rhs: sc.right.units - sc.left.units };
}

/** Rank of the coefficient matrix (exact rational elimination). */
export function coefficientRank(p: Pick<BalancePuzzle, 'shapes' | 'scales'>): number {
  const m: Rational[][] = p.scales.map((sc) => row(sc, p.shapes).coef.map((c) => rat(c)));
  const cols = p.shapes.length;
  let rank = 0;
  for (let c = 0; c < cols && rank < m.length; c++) {
    const piv = m.findIndex((r, i) => i >= rank && r[c]!.n !== 0);
    if (piv < 0) continue;
    [m[rank], m[piv]] = [m[piv]!, m[rank]!];
    const pr = m[rank]!;
    for (let i = 0; i < m.length; i++) {
      if (i === rank || m[i]![c]!.n === 0) continue;
      const f = div(m[i]![c]!, pr[c]!);
      m[i] = m[i]!.map((v, j) => sub(v, mul(f, pr[j]!)));
    }
    rank++;
  }
  return rank;
}

/** Every full assignment of shape weights in [0, max] that balances all scales. */
export function allAssignments(p: BalancePuzzle, fixed: Record<string, number> = {}): Record<string, number>[] {
  const free = p.shapes.filter((s) => !(s in fixed));
  const out: Record<string, number>[] = [];
  const w: Record<string, number> = { ...fixed };
  const rec = (i: number): void => {
    if (i === free.length) {
      if (p.scales.every((sc) => balances(sc, w))) out.push({ ...w });
      return;
    }
    for (let v = 0; v <= p.max; v++) {
      w[free[i]!] = v;
      rec(i + 1);
    }
  };
  rec(0);
  return out;
}

export interface DerivationStep {
  /** `single`: one scale holds one unknown kind. `compare`: two scales added or subtracted leave one. */
  via: 'single' | 'compare';
  scales: number[];
  shape: string;
}

/**
 * How a child can find the weights one at a time: first any scale with a single
 * unknown kind of shape; when stuck, two scales compared (difference) or put
 * together (sum) so that one unknown kind is left. Covers every shape exactly
 * when the puzzle is solvable without general algebra.
 */
export function derivation(p: BalancePuzzle): DerivationStep[] {
  const known = new Set<string>();
  const steps: DerivationStep[] = [];
  const rows = p.scales.map((sc) => row(sc, p.shapes).coef);
  const unknownIn = (coef: readonly number[]): string[] => p.shapes.filter((s, j) => coef[j] !== 0 && !known.has(s));
  const learn = (via: DerivationStep['via'], scales: number[], coef: readonly number[]): boolean => {
    const u = unknownIn(coef);
    if (u.length !== 1) return false;
    known.add(u[0]!);
    steps.push({ via, scales, shape: u[0]! });
    return true;
  };
  for (let progress = true; progress && known.size < p.shapes.length; ) {
    progress = false;
    rows.forEach((r, i) => {
      if (learn('single', [i], r)) progress = true;
    });
    if (progress) continue;
    search: for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        for (const sign of [-1, 1]) {
          if (learn('compare', [i, j], rows[i]!.map((c, k) => c + sign * rows[j]![k]!))) {
            progress = true;
            break search;
          }
        }
      }
    }
  }
  return steps;
}

// ---------------------------------------------------------------- generation

interface Sample {
  puzzle: BalancePuzzle;
  features: Record<string, number>;
  score: number;
}

const pan = (units: number, ...items: Array<[string, number]>): Pan => ({
  shapes: items.filter(([, c]) => c > 0).map(([shape, count]) => ({ shape, count })),
  units,
});

const A_TEMPLATES = ['direct', 'plus', 'multiple', 'chainPlus', 'chainDouble', 'pair', 'pairMultiple'] as const;
type ATemplate = (typeof A_TEMPLATES)[number];
const A_BASE: Record<ATemplate, number> = {
  direct: 0.02, plus: 0.25, multiple: 0.3, chainPlus: 0.5, chainDouble: 0.55, pair: 0.65, pairMultiple: 0.8,
};

function sampleA(rng: Rng): Sample {
  const t = rng.pick(A_TEMPLATES);
  const [x, y] = rng.shuffle(SHAPE_IDS); // x: the asked shape; y: the helper shape
  const X = x!;
  const Y = y!;
  let scales: Scale[];
  let answer: number;
  switch (t) {
    case 'direct':
      answer = rng.int(1, 10);
      scales = [{ left: pan(0, [X, 1]), right: pan(answer) }];
      break;
    case 'plus': {
      answer = rng.int(1, 8);
      const k = rng.int(1, 10 - answer);
      scales = [{ left: pan(k, [X, 1]), right: pan(answer + k) }];
      break;
    }
    case 'multiple': {
      const c = rng.pick([2, 2, 3]);
      answer = rng.int(1, Math.floor(10 / c));
      scales = [{ left: pan(0, [X, c]), right: pan(c * answer) }];
      break;
    }
    case 'chainPlus': {
      const a = rng.int(1, 7);
      const b = rng.int(1, 10 - a);
      answer = a + b;
      scales = [{ left: pan(0, [Y, 1]), right: pan(a) }, { left: pan(0, [X, 1]), right: pan(b, [Y, 1]) }];
      break;
    }
    case 'chainDouble': {
      const a = rng.int(1, 5);
      answer = 2 * a;
      scales = [{ left: pan(0, [Y, 1]), right: pan(a) }, { left: pan(0, [X, 1]), right: pan(0, [Y, 2]) }];
      break;
    }
    case 'pair': {
      const a = rng.int(1, 8);
      answer = rng.int(1, 10 - a);
      scales = [{ left: pan(0, [Y, 1]), right: pan(a) }, { left: pan(0, [X, 1], [Y, 1]), right: pan(a + answer) }];
      break;
    }
    case 'pairMultiple': {
      const a = rng.int(1, 5);
      answer = rng.int(1, 10 - a);
      scales = [{ left: pan(0, [Y, 2]), right: pan(2 * a) }, { left: pan(0, [X, 1], [Y, 1]), right: pan(a + answer) }];
      break;
    }
  }
  const swapped = scales.length > 1 && rng.chance(0.5);
  if (swapped) scales.reverse();
  const shapes = [...new Set(scales.flatMap((s) => [...s.left.shapes, ...s.right.shapes].map((i) => i.shape)))];
  const puzzle: BalancePuzzle = { shapes, scales, ask: [X], max: 10 };
  const maxUnits = Math.max(...scales.flatMap((s) => [s.left.units, s.right.units]));
  return {
    puzzle,
    features: {
      rank: A_TEMPLATES.indexOf(t),
      scales: scales.length,
      shapes: shapes.length,
      unknowns: 1,
      maxUnits,
      answer,
      anchorLast: Number(swapped),
    },
    score: A_BASE[t] + (t === 'direct' && answer > 5 ? 0.03 : 0) + (t === 'multiple' && maxUnits > 6 ? 0.05 : 0) + (swapped ? 0.04 : 0),
  };
}

function sampleBC(rng: Rng, band: BandId): Sample | null {
  const C = band === 'C';
  const max = C ? 30 : 15;
  const unitCap = C ? 99 : 40;
  const maxCoef = C ? 3 : 2;
  const k = rng.pick([2, 3]);
  const shapes = rng.shuffle(SHAPE_IDS).slice(0, k);
  const w: Record<string, number> = {};
  const used = new Set<number>();
  for (const s of shapes) {
    let v = rng.int(1, max);
    while (used.has(v)) v = rng.int(1, max);
    used.add(v);
    w[s] = v;
  }
  const scales: Scale[] = [];
  for (let i = 0; i < k; i++) {
    const support = rng.shuffle(shapes).slice(0, rng.int(1, Math.min(3, k)));
    const left: Array<[string, number]> = [];
    const right: Array<[string, number]> = [];
    support.forEach((s, j) => {
      const c = rng.chance(0.65) ? 1 : rng.int(2, maxCoef);
      (j === 0 || rng.chance(0.55) ? left : right).push([s, c]);
    });
    const diff = left.reduce((a, [s, c]) => a + c * w[s]!, 0) - right.reduce((a, [s, c]) => a + c * w[s]!, 0);
    const sc: Scale = { left: pan(Math.max(0, -diff), ...left), right: pan(Math.max(0, diff), ...right) };
    const icons = (pn: Pan): number => pn.shapes.reduce((a, it) => a + it.count, 0);
    if (Math.max(sc.left.units, sc.right.units) > unitCap || icons(sc.left) > 5 || icons(sc.right) > 5) return null;
    scales.push(sc);
  }
  const ordered = shapes.filter((s) => scales.some((sc) => [...sc.left.shapes, ...sc.right.shapes].some((i) => i.shape === s)));
  if (ordered.length !== k) return null;
  const puzzle: BalancePuzzle = { shapes: ordered, scales, ask: [...ordered], max };
  if (coefficientRank(puzzle) !== k) return null;
  const chain = derivation(puzzle);
  if (chain.length !== k) return null; // would need general algebra: not a children's puzzle
  const compare = chain.filter((c) => c.via === 'compare').length;
  const anchors = scales.filter((sc) => new Set([...sc.left.shapes, ...sc.right.shapes].map((i) => i.shape)).size === 1).length;
  const shapeVsShape = scales.filter((sc) => sc.left.shapes.length > 0 && sc.right.shapes.length > 0).length;
  const coefMax = Math.max(...scales.flatMap((sc) => [...sc.left.shapes, ...sc.right.shapes].map((i) => i.count)));
  const maxW = Math.max(...Object.values(w));
  /** Reasoning steps: one per unknown, plus one per comparison of two scales. */
  const work = k + compare;
  return {
    puzzle,
    features: { unknowns: k, scales: k, work, compare, anchors, shapeVsShape, coefMax, maxW },
    score:
      0.04 +
      0.22 * (work - 2) +
      0.04 * Math.min(2, shapeVsShape) +
      (coefMax >= 2 ? 0.05 : 0) +
      (coefMax >= 3 ? 0.04 : 0) +
      0.1 * clamp01((maxW - 5) / 25),
  };
}

function fallbackBC(rng: Rng, band: BandId): Sample {
  // x = a; x + y = a + b — always full rank, unique, easy.
  const [x, y] = rng.shuffle(SHAPE_IDS);
  const a = rng.int(2, 9);
  const b = rng.int(1, 9);
  const puzzle: BalancePuzzle = {
    shapes: [x!, y!],
    scales: [{ left: pan(0, [x!, 1]), right: pan(a) }, { left: pan(0, [x!, 1], [y!, 1]), right: pan(a + b) }],
    ask: [x!, y!],
    max: band === 'C' ? 30 : 15,
  };
  return {
    puzzle,
    features: { unknowns: 2, scales: 2, work: 2, compare: 0, anchors: 1, shapeVsShape: 0, coefMax: 1, maxW: Math.max(a, b) },
    score: 0.04,
  };
}

// ---------------------------------------------------------------- solving, checking, hints

function solveBalance(p: BalancePuzzle): BalanceAnswer[] {
  return uniqCanon(allAssignments(p).map((full) => Object.fromEntries(p.ask.map((s) => [s, full[s]!]))));
}

function checkBalance(p: BalancePuzzle, answer: BalanceAnswer): CheckResult {
  const bad = p.ask.filter((s) => {
    const v = answer?.[s];
    return !isInt(v) || v < 0 || v > p.max;
  });
  if (bad.length) return fail(bad.map((s) => `shape:${s}`));
  const fixed: Record<string, number> = {};
  for (const s of p.ask) fixed[s] = answer[s]!;
  if (allAssignments(p, fixed).length > 0) return ok();
  // Report scales against the reference weights of the shapes the child did not enter.
  const ref = allAssignments(p)[0] ?? {};
  const w = { ...ref, ...fixed };
  return fail(p.scales.map((sc, i) => (balances(sc, w) ? '' : `scale:${i}`)).filter(Boolean));
}

function hintBalance(p: BalancePuzzle, tier: number): PuzzleHint | null {
  const chain = derivation(p);
  const sol = allAssignments(p)[0];
  if (!sol || chain.length === 0) return null;
  if (tier === 1) {
    const first = chain[0]!;
    if (first.via === 'compare') return { key: 'puzzle.hint.balance.compare', params: {}, focus: first.scales.map((i) => `scale:${i}`) };
    return { key: 'puzzle.hint.balance.start', params: {}, focus: [`scale:${first.scales[0]!}`, `shape:${first.shape}`] };
  }
  if (p.shapes.length === 1) {
    if (tier !== 2) return null;
    const sc = p.scales[0]!;
    const item = sc.left.shapes[0]!;
    if (sc.left.units > 0) return { key: 'puzzle.hint.balance.remove', params: { units: sc.left.units }, focus: ['pan:0:left', 'pan:0:right'] };
    if (item.count > 1) return { key: 'puzzle.hint.balance.share', params: { count: item.count, units: sc.right.units }, focus: ['pan:0:right'] };
    return { key: 'puzzle.hint.balance.count', params: {}, focus: ['pan:0:right'] };
  }
  // Reveal shapes in solving order, one per tier, never the last one (that would be the whole answer).
  const i = tier - 2;
  if (i >= chain.length - 1) return null;
  const shape = chain[i]!.shape;
  return { key: 'puzzle.hint.balance.known', params: { shape, weight: sol[shape]! }, focus: [`shape:${shape}`] };
}

// ---------------------------------------------------------------- definition

const BANDS: readonly BandId[] = ['A', 'B', 'C'];

export const balancePuzzle: PuzzleTypeDef<BalancePuzzle, BalanceAnswer> = {
  id: 'balance',
  version: 1,
  bands: BANDS,

  generate(rng, band, level) {
    assertBand('balance', BANDS, band);
    const { value, level: achieved } = pickByLevel(
      rng,
      clamp01(level),
      (r) =>
        band === 'A'
          ? sampleA(r)
          : sampleUntil<Sample>(r, (rr) => sampleBC(rr, band), () => true, (rr) => fallbackBC(rr, band)),
      (s) => s.score,
    );
    return { puzzle: value.puzzle, achievedLevel: achieved, features: value.features };
  },

  check: checkBalance,
  solve: solveBalance,
  hint: hintBalance,
};
