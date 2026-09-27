/**
 * Logic grids (B/C): who goes with what, from icon-only clues.
 *
 * There are 2 or 3 categories of 3 or 4 items each. Items are abstract ids the
 * UI draws as icons: `categories[0]` are the anchors (rows, e.g. children
 * `a0`…`a3`), and every other category (`b0`…, `c0`…) is matched one-to-one
 * to the anchors. Clues are pairs of items drawn side by side with a "same"
 * or a "not same" sign (≠ is drawn as SVG): `same` means they belong to the
 * same anchor, `diff` that they do not. Clues may link two non-anchor
 * categories, which is where 3-category grids get interesting.
 *
 * Every generated grid is solvable by elimination alone (no guessing), which
 * also makes the solution unique, and its clue set is minimal: dropping any
 * clue would leave it unsolvable by elimination.
 *
 * The answer names, for every non-anchor item, the anchor it belongs to.
 * Violated constraint ids: `missing:<item>` (no valid anchor), `twice:<anchor>:<k>`
 * (the anchor got two items of category k), `clue:<i>` (clue i is broken).
 * Focus ids in hints: `clue:<i>`, `cell:<anchor>:<item>`.
 */
import type { Rng } from '../../core/rng';
import type { BandId } from '../../core/types';
import { fail, ok, type CheckResult, type PuzzleHint, type PuzzleTypeDef } from '../types';
import { assertBand, clamp01, pickByLevel, sampleUntil, uniqCanon } from '../util';

export interface LogicClue {
  kind: 'same' | 'diff';
  a: string;
  b: string;
}

export interface LogicPuzzle {
  /** categories[0]: anchors (rows). Each list has the same length (3 or 4). */
  categories: string[][];
  clues: LogicClue[];
}

/** Anchor id per non-anchor item id. */
export type LogicAnswer = Record<string, string>;

const PREFIX = ['a', 'b', 'c'] as const;
const MAX_CLUES = 8;

const catOf = (p: LogicPuzzle, item: string): number => p.categories.findIndex((c) => c.includes(item));

/** Owner (anchor) of an item under an assignment; an anchor owns itself. */
function owner(p: LogicPuzzle, ans: LogicAnswer, item: string): string | undefined {
  return p.categories[0]!.includes(item) ? item : ans[item];
}

export const clueHolds = (p: LogicPuzzle, ans: LogicAnswer, c: LogicClue): boolean => {
  const oa = owner(p, ans, c.a);
  const ob = owner(p, ans, c.b);
  if (oa === undefined || ob === undefined) return false;
  return c.kind === 'same' ? oa === ob : oa !== ob;
};

function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  return permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

/** Every assignment satisfying the clues (brute force; at most 24² candidates). */
export function logicSolutions(p: LogicPuzzle): LogicAnswer[] {
  const anchors = p.categories[0]!;
  const perms = permutations(anchors.length);
  const out: LogicAnswer[] = [];
  const rec = (k: number, ans: LogicAnswer): void => {
    if (k === p.categories.length) {
      if (p.clues.every((c) => clueHolds(p, ans, c))) out.push({ ...ans });
      return;
    }
    for (const perm of perms) {
      const next = { ...ans };
      p.categories[k]!.forEach((item, i) => (next[item] = anchors[perm[i]!]!));
      rec(k + 1, next);
    }
  };
  rec(1, {});
  return out;
}

/**
 * Elimination as a child does it on the grid: mark ✓/✗ from the clues, then
 * repeat until nothing changes: a ✓ crosses out its row and column, a lone
 * open cell in a row or column becomes ✓, and clues between two non-anchor
 * items pass marks across through the anchor. Returns the number of rounds
 * and the ✓ cells found (null when elimination alone gets stuck).
 */
export function eliminate(p: LogicPuzzle): { rounds: number; order: Array<{ item: string; anchor: string }> } | null {
  const anchors = p.categories[0]!;
  const n = anchors.length;
  // m[item][anchorIndex]: 0 open, 1 yes, -1 no.
  const m = new Map<string, number[]>();
  for (const cat of p.categories.slice(1)) for (const it of cat) m.set(it, Array<number>(n).fill(0));
  const order: Array<{ item: string; anchor: string }> = [];
  let changed = false;
  const set = (item: string, ai: number, v: 1 | -1): void => {
    const row = m.get(item)!;
    if (row[ai] === v) return;
    if (row[ai] !== 0) throw new Error('contradiction');
    row[ai] = v;
    changed = true;
    if (v === 1) order.push({ item, anchor: anchors[ai]! });
  };
  try {
    for (const c of p.clues) {
      const [x, y] = catOf(p, c.a) === 0 ? [c.a, c.b] : [c.b, c.a];
      if (catOf(p, x) !== 0) continue;
      set(y, anchors.indexOf(x), c.kind === 'same' ? 1 : -1);
    }
    let rounds = 0;
    do {
      changed = false;
      rounds++;
      for (const c of p.clues) {
        if (catOf(p, c.a) === 0 || catOf(p, c.b) === 0) continue;
        for (const [x, y] of [[c.a, c.b], [c.b, c.a]] as const) {
          const rx = m.get(x)!;
          for (let ai = 0; ai < n; ai++) {
            if (c.kind === 'same' && rx[ai] !== 0) set(y, ai, rx[ai] as 1 | -1);
            if (c.kind === 'diff' && rx[ai] === 1) set(y, ai, -1);
          }
        }
      }
      for (const cat of p.categories.slice(1)) {
        for (const it of cat) {
          const row = m.get(it)!;
          const yes = row.indexOf(1);
          if (yes >= 0) {
            for (let ai = 0; ai < n; ai++) if (ai !== yes) set(it, ai, -1);
            for (const other of cat) if (other !== it) set(other, yes, -1);
          } else if (row.filter((v) => v !== -1).length === 1) set(it, row.findIndex((v) => v !== -1), 1);
        }
        for (let ai = 0; ai < n; ai++) {
          const open = cat.filter((it) => m.get(it)![ai] !== -1);
          if (open.length === 1 && !cat.some((it) => m.get(it)![ai] === 1)) set(open[0]!, ai, 1);
        }
      }
    } while (changed);
    const solved = [...m.values()].every((row) => row.filter((v) => v === 1).length === 1);
    return solved ? { rounds, order } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- generation

interface Sample {
  puzzle: LogicPuzzle;
  features: Record<string, number>;
  score: number;
}

const SIZE_BASE: Record<string, number> = { '3x2': 0, '4x2': 0.25, '3x3': 0.4, '4x3': 0.62 };

function sampleLogic(rng: Rng, band: BandId): Sample | null {
  const n = rng.pick([3, 4]);
  const k = band === 'B' ? (n === 3 ? rng.pick([2, 3]) : 2) : rng.pick([2, 3]);
  const categories = Array.from({ length: k }, (_, c) => rng.shuffle(Array.from({ length: n }, (_, i) => `${PREFIX[c]}${i}`)));
  const anchors = categories[0]!;
  const truth: LogicAnswer = {};
  for (const cat of categories.slice(1)) {
    const perm = rng.shuffle(anchors);
    cat.forEach((it, i) => (truth[it] = perm[i]!));
  }
  const all = categories.flat();
  const ownerOf = (it: string): string => (anchors.includes(it) ? it : truth[it]!);
  // Every true clue between items of different categories.
  const pool: LogicClue[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (a[0] === b[0]) continue;
      pool.push({ kind: ownerOf(a) === ownerOf(b) ? 'same' : 'diff', a, b });
    }
  }
  // Diff-heavy clue sets need more elimination: the mix is drawn per sample.
  const pSame = 0.15 + 0.6 * rng.next();
  const ordered = rng.shuffle(pool);
  const same = ordered.filter((c) => c.kind === 'same');
  const diff = ordered.filter((c) => c.kind === 'diff');
  const clues: LogicClue[] = [];
  while (!eliminate({ categories, clues })) {
    const from = (rng.chance(pSame) && same.length) || !diff.length ? same : diff;
    const c = from.shift();
    if (!c) return null;
    clues.push(c);
  }
  // Minimise: drop clues that elimination does not need.
  for (const c of rng.shuffle(clues)) {
    const without = clues.filter((x) => x !== c);
    if (eliminate({ categories, clues: without })) clues.splice(clues.indexOf(c), 1);
  }
  if (clues.length > MAX_CLUES) return null;
  const puzzle: LogicPuzzle = { categories, clues: rng.shuffle(clues) };
  const e = eliminate(puzzle)!;
  const diffShare = clues.filter((c) => c.kind === 'diff').length / clues.length;
  const cross = clues.filter((c) => c.a[0] !== 'a' && c.b[0] !== 'a').length;
  return {
    puzzle,
    features: { size: n, categories: k, clues: clues.length, diffShare, cross, rounds: e.rounds },
    score: SIZE_BASE[`${n}x${k}`]! + 0.18 * diffShare + 0.04 * Math.min(4, e.rounds - 1) + (cross > 0 ? 0.05 : 0),
  };
}

function fallbackLogic(rng: Rng): Sample {
  // 3 anchors, 3 items: two "same" clues settle it.
  const anchors = rng.shuffle(['a0', 'a1', 'a2']);
  const items = rng.shuffle(['b0', 'b1', 'b2']);
  const puzzle: LogicPuzzle = {
    categories: [anchors, items],
    clues: [
      { kind: 'same', a: anchors[0]!, b: items[0]! },
      { kind: 'same', a: anchors[1]!, b: items[1]! },
    ],
  };
  return { puzzle, features: { size: 3, categories: 2, clues: 2, diffShare: 0, cross: 0, rounds: 1 }, score: 0 };
}

// ---------------------------------------------------------------- checking, solving, hints

function checkLogic(p: LogicPuzzle, answer: LogicAnswer): CheckResult {
  const anchors = p.categories[0]!;
  const ans = answer ?? {};
  const violated: string[] = [];
  p.categories.slice(1).forEach((cat) => {
    for (const it of cat) if (!anchors.includes(ans[it] as string)) violated.push(`missing:${it}`);
  });
  p.categories.slice(1).forEach((cat, i) => {
    for (const a of anchors) if (cat.filter((it) => ans[it] === a).length > 1) violated.push(`twice:${a}:${i + 1}`);
  });
  p.clues.forEach((c, i) => {
    if (!clueHolds(p, ans, c)) violated.push(`clue:${i}`);
  });
  return violated.length ? fail(violated) : ok();
}

function solveLogic(p: LogicPuzzle): LogicAnswer[] {
  return uniqCanon(logicSolutions(p));
}

function hintLogic(p: LogicPuzzle, tier: number): PuzzleHint | null {
  const e = eliminate(p);
  const sol = logicSolutions(p)[0];
  if (!sol) return null;
  if (tier === 1) {
    const i = p.clues.findIndex((c) => c.kind === 'same' && (c.a[0] === 'a' || c.b[0] === 'a'));
    const start = i >= 0 ? i : p.clues.findIndex((c) => c.a[0] === 'a' || c.b[0] === 'a');
    return { key: 'puzzle.hint.logic.start', params: {}, focus: [`clue:${Math.max(0, start)}`] };
  }
  // Then ✓ cells in the order elimination finds them, skipping pairs a clue already
  // states outright, and never the last one.
  const stated = new Set(p.clues.filter((c) => c.kind === 'same').flatMap((c) => [`${c.a}|${c.b}`, `${c.b}|${c.a}`]));
  const found = e?.order ?? Object.entries(sol).map(([item, anchor]) => ({ item, anchor }));
  const derived = found.filter(({ item, anchor }) => !stated.has(`${item}|${anchor}`));
  const order = derived.length ? derived : found;
  const total = p.categories.slice(1).reduce((s, c) => s + c.length, 0);
  const i = tier - 2;
  if (tier > 3 || i >= Math.min(order.length, total - 1)) return null;
  const { item, anchor } = order[i]!;
  return { key: 'puzzle.hint.logic.pair', params: { item, anchor }, focus: [`cell:${anchor}:${item}`] };
}

// ---------------------------------------------------------------- definition

const BANDS: readonly BandId[] = ['B', 'C'];

export const logicPuzzle: PuzzleTypeDef<LogicPuzzle, LogicAnswer> = {
  id: 'logic',
  version: 1,
  bands: BANDS,

  generate(rng, band, level) {
    assertBand('logic', BANDS, band);
    const { value, level: achieved } = pickByLevel(
      rng,
      clamp01(level),
      (r) => sampleUntil<Sample>(r, (rr) => sampleLogic(rr, band), () => true, fallbackLogic, 20),
      (s) => s.score,
      24,
    );
    return { puzzle: value.puzzle, achievedLevel: achieved, features: value.features };
  },

  check: checkLogic,
  solve: solveLogic,
  hint: hintLogic,
};
