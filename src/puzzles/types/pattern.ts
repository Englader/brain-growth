/**
 * Pattern extension (A–C): "what comes next?".
 *
 * Band A shows a row of picture tiles (abstract tile ids `t0`…`t7`; the UI
 * draws them as distinct shape+colour pairs) and the child taps the next tile
 * from the palette of tiles used. Families: repeating units (AB, AAB, ABB, ABC,
 * AABB, ABAC) and growing patterns (A B, A B B, A B B B … and A B, A A B, …).
 *
 * Bands B/C show a number sequence and the child types the next number.
 * Families, simplest first: arithmetic, geometric, alternating steps,
 * constant second difference, and Fibonacci-like (C only).
 *
 * Unambiguity: a sequence is only used when no rule family of the same or
 * lower complexity also fits the shown terms (with enough terms to count as
 * evidence) but predicts a different next term. The solver applies the same
 * idea: it returns the predictions of the simplest fitting families, so a
 * generated puzzle has exactly one answer.
 *
 * Violated constraint ids: `next` (the answer is not what the rule gives).
 * Focus ids in hints: `pos:<i>` (a shown term), `next` (the answer slot),
 * `group:<i>-<j>` (inclusive term range of one group of a growing pattern),
 * `gaps` (show differences between neighbours), `ratios` (show ratios).
 */
import { eq, isInteger, mul, rat, sub, toNumber, type Rational } from '../../core/rational';
import type { Rng } from '../../core/rng';
import type { BandId } from '../../core/types';
import { fail, ok, type PuzzleHint, type PuzzleTypeDef } from '../types';
import { assertBand, clamp01, pickByLevel, sampleUntil, uniq } from '../util';

export const TILE_IDS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'] as const;

export type RepeatFamily = 'AB' | 'AAB' | 'ABB' | 'ABC' | 'AABB' | 'ABAC';
export type GrowFamily = 'growB' | 'growA';
export type TileFamily = RepeatFamily | GrowFamily;
export type NumberFamily = 'arith' | 'geom' | 'alt' | 'second' | 'fib';

export interface TilePattern {
  kind: 'tiles';
  family: TileFamily;
  /** Shown tiles, left to right. */
  seq: string[];
  /** The distinct tiles used, shuffled: the choices the child taps. */
  palette: string[];
}

export interface NumberPattern {
  kind: 'numbers';
  family: NumberFamily;
  /** Shown terms, left to right (integers; may be negative in Band C). */
  seq: number[];
}

export type PatternPuzzle = TilePattern | NumberPattern;
/** A tile id for `tiles`, an integer for `numbers`. */
export type PatternAnswer = string | number;

// ---------------------------------------------------------------- tiles

const REPEAT_UNITS: Record<RepeatFamily, readonly number[]> = {
  AB: [0, 1],
  AAB: [0, 0, 1],
  ABB: [0, 1, 1],
  ABC: [0, 1, 2],
  AABB: [0, 0, 1, 1],
  ABAC: [0, 1, 0, 2],
};
const REPEAT_FAMILIES = Object.keys(REPEAT_UNITS) as RepeatFamily[];
const TILE_RANK: Record<TileFamily, number> = { AB: 0, AAB: 1, ABB: 1, ABC: 2, AABB: 3, ABAC: 4, growB: 5, growA: 5 };
const TILE_BASE: Record<TileFamily, number> = {
  AB: 0.02, AAB: 0.18, ABB: 0.2, ABC: 0.28, AABB: 0.4, ABAC: 0.48, growB: 0.64, growA: 0.72,
};
/** Longest row of tiles drawn (fits 360 px with the answer slot). */
const MAX_TILES = 10;
/** Complexity of a growing rule: above every repeating unit. */
const GROW_COMPLEXITY = 10;

const isGrow = (f: TileFamily): f is GrowFamily => f === 'growB' || f === 'growA';

export function growSeq(family: GrowFamily, a: string, b: string, n: number): string[] {
  const out: string[] = [];
  for (let g = 1; out.length < n; g++) {
    if (family === 'growB') out.push(a, ...Array<string>(g).fill(b));
    else out.push(...Array<string>(g).fill(a), b);
  }
  return out.slice(0, n);
}

function fitsRepeat<T>(seq: readonly T[], q: number): boolean {
  for (let i = q; i < seq.length; i++) if (seq[i] !== seq[i - q]) return false;
  return true;
}

interface TileRule {
  rule: string;
  complexity: number;
  next: string;
}

/** Every tile rule that fits the shown row with enough evidence, and its prediction. */
export function tileRules(seq: readonly string[]): TileRule[] {
  const L = seq.length;
  const out: TileRule[] = [];
  for (let q = 1; 2 * q <= L; q++) if (fitsRepeat(seq, q)) out.push({ rule: `repeat${q}`, complexity: q, next: seq[L - q]! });
  const a = seq[0];
  const b = seq.find((t) => t !== a);
  if (a !== undefined && b !== undefined && L >= 9) {
    for (const fam of ['growB', 'growA'] as const) {
      const g = growSeq(fam, a, b, L + 1);
      if (g.slice(0, L).every((t, i) => t === seq[i])) out.push({ rule: fam, complexity: GROW_COMPLEXITY, next: g[L]! });
    }
  }
  return out;
}

function tileIntended(p: TilePattern): { complexity: number; next: string } {
  const L = p.seq.length;
  if (isGrow(p.family)) {
    const a = p.seq[0]!;
    const b = p.seq.find((t) => t !== a)!;
    return { complexity: GROW_COMPLEXITY, next: growSeq(p.family, a, b, L + 1)[L]! };
  }
  const q = REPEAT_UNITS[p.family].length;
  return { complexity: q, next: p.seq[L - q]! };
}

// ---------------------------------------------------------------- numbers

const COMPLEXITY: Record<NumberFamily, number> = { arith: 1, geom: 2, alt: 3, second: 3, fib: 4 };
const NUM_RANK: Record<NumberFamily, number> = { arith: 0, geom: 1, alt: 2, second: 3, fib: 4 };
/** Fewest shown terms that count as evidence for a family. */
const MIN_TERMS: Record<NumberFamily, number> = { arith: 3, geom: 3, alt: 5, second: 4, fib: 4 };
const FAMILIES = Object.keys(COMPLEXITY) as NumberFamily[];

const diffs = (s: readonly number[]): number[] => s.slice(1).map((v, i) => v - s[i]!);

/** The next term `fam` predicts if it fits the shown terms with enough evidence; else null. */
export function predictNext(fam: NumberFamily, seq: readonly number[]): Rational | null {
  const L = seq.length;
  if (L < MIN_TERMS[fam]) return null;
  const last = seq[L - 1]!;
  const d = diffs(seq);
  switch (fam) {
    case 'arith':
      return d.every((x) => x === d[0]) ? rat(last + d[0]!) : null;
    case 'geom': {
      if (seq.some((x) => x === 0)) return null;
      const r = rat(seq[1]!, seq[0]!);
      for (let i = 1; i < L; i++) if (!eq(rat(seq[i]!, seq[i - 1]!), r)) return null;
      return mul(rat(last), r);
    }
    case 'alt':
      for (let i = 2; i < d.length; i++) if (d[i] !== d[i - 2]) return null;
      return rat(last + d[d.length - 2]!);
    case 'second': {
      const d2 = diffs(d);
      return d2.every((x) => x === d2[0]) ? rat(last + d[d.length - 1]! + d2[0]!) : null;
    }
    case 'fib':
      for (let i = 2; i < L; i++) if (seq[i] !== seq[i - 1]! + seq[i - 2]!) return null;
      return rat(last + seq[L - 2]!);
  }
}

/**
 * Rival rules: families other than the intended one, of the same or lower
 * complexity, that also fit the shown terms but predict a different next term.
 * A puzzle is unambiguous exactly when this is empty.
 */
export function patternRivals(p: PatternPuzzle): string[] {
  if (p.kind === 'tiles') {
    const want = tileIntended(p);
    return tileRules(p.seq)
      .filter((r) => r.complexity <= want.complexity && r.next !== want.next)
      .map((r) => r.rule);
  }
  const want = predictNext(p.family, p.seq);
  if (!want) return [p.family];
  return FAMILIES.filter((f) => {
    if (f === p.family || COMPLEXITY[f] > COMPLEXITY[p.family]) return false;
    const got = predictNext(f, p.seq);
    return got !== null && !eq(got, want);
  });
}

// ---------------------------------------------------------------- generation

interface Sample {
  puzzle: PatternPuzzle;
  features: Record<string, number>;
  score: number;
}

function sampleTiles(rng: Rng): Sample {
  const family = rng.pick([...REPEAT_FAMILIES, 'growB', 'growA'] as const);
  const tiles = rng.shuffle(TILE_IDS).slice(0, 3);
  let seq: string[];
  let cycles = 0;
  /** Position of the answer inside its unit or group (0 = it starts a new one). */
  let phase = 0;
  if (isGrow(family)) {
    seq = growSeq(family, tiles[0]!, tiles[1]!, rng.int(9, MAX_TILES));
    for (let g = 1, start = 0; ; start += ++g) {
      if (start + g + 1 > seq.length) {
        phase = seq.length - start;
        break;
      }
    }
  } else {
    // Units are primitive and at least two cycles are shown, so (Fine–Wilf) no
    // shorter period can fit the row: repeating rows are unambiguous by construction.
    const unit = REPEAT_UNITS[family];
    const q = unit.length;
    const len = rng.int(2 * q, Math.min(MAX_TILES, 3 * q));
    cycles = Math.floor(len / q);
    phase = len % q;
    seq = Array.from({ length: len }, (_, i) => tiles[unit[i % q]!]!);
  }
  const palette = rng.shuffle(uniq(seq));
  const puzzle: TilePattern = { kind: 'tiles', family, seq, palette };
  // Harder spots: mid-unit for a repeat; the start of a new group for a growing row.
  const hardSpot = isGrow(family) ? phase === 0 : phase > 0;
  const features = {
    rank: TILE_RANK[family],
    period: isGrow(family) ? 0 : REPEAT_UNITS[family].length,
    grow: Number(isGrow(family)),
    tiles: palette.length,
    shown: seq.length,
    cycles,
    phase,
  };
  const score = TILE_BASE[family] + (cycles === 2 ? 0.05 : 0) + (hardSpot ? 0.04 : 0);
  return { puzzle, features, score };
}

interface NumDraft {
  family: NumberFamily;
  seq: number[];
  /** Rule parameters, used only for scoring. */
  d?: number;
  r?: Rational;
  c2?: number;
  d0?: number;
  d1?: number;
  d2?: number;
}

const NICE_STEPS = new Set([1, 2, 5, 10, 20, 25, 50, 100]);
const withinB = (s: readonly number[]): boolean => s.every((x) => x >= 0 && x <= 1000);
const withinC = (s: readonly number[]): boolean => s.every((x) => Math.abs(x) <= 100_000);

function draftFamily(rng: Rng, band: BandId, family: NumberFamily): NumDraft | null {
  const C = band === 'C';
  switch (family) {
    case 'arith': {
      const L = C ? rng.int(4, 5) : 5;
      const steps = C
        ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 15, 20, 25, 50, 75, 125]
        : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 25, 50, 100];
      let d = rng.pick(steps);
      let a: number;
      if (rng.chance(C ? 0.45 : 0.3)) {
        d = -d;
        a = C ? rng.int(-20, 8 * -d) : rng.int(L * -d, L * -d + 40);
      } else a = C ? rng.int(-40, 120) : rng.int(0, 40);
      return { family, seq: Array.from({ length: L + 1 }, (_, i) => a + i * d), d };
    }
    case 'geom': {
      const L = C ? rng.int(4, 5) : 4;
      if (C && rng.chance(0.25)) {
        const m = rng.int(1, 12);
        return { family, seq: Array.from({ length: L + 1 }, (_, i) => m * 2 ** (L - i)), r: rat(1, 2) };
      }
      const rs = C ? [2, 3, 4, 5, 10, -2, -3] : [2, 2, 3, 5];
      const r = rng.pick(rs);
      const aMax = Math.max(1, Math.floor((C ? 100_000 : 1000) / Math.abs(r) ** L));
      const a = rng.int(1, Math.min(C ? 9 : 12, aMax));
      return { family, seq: Array.from({ length: L + 1 }, (_, i) => a * r ** i), r: rat(r) };
    }
    case 'alt': {
      const L = rng.int(6, 7);
      const d1 = C ? rng.pick([-12, -9, -7, -5, -4, -3, -2, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15]) : rng.int(1, 10);
      const d2 = C ? rng.int(-12, 15) : rng.int(-6, 10);
      if (d2 === 0 || d2 === d1 || d2 === -d1) return null;
      const a = C ? rng.int(-10, 40) : rng.int(0, 20);
      const seq = [a];
      for (let i = 1; i <= L; i++) seq.push(seq[i - 1]! + (i % 2 ? d1 : d2));
      return { family, seq, d1, d2 };
    }
    case 'second': {
      const L = 5;
      const a = C ? rng.int(-10, 30) : rng.int(0, 15);
      const d0 = C ? rng.int(-6, 8) : rng.int(1, 6);
      const c2 = C ? rng.pick([1, 2, 3, 4, -1, -2]) : rng.pick([1, 1, 2]);
      const seq = [a];
      for (let i = 1; i <= L; i++) seq.push(seq[i - 1]! + d0 + (i - 1) * c2);
      return { family, seq, d0, c2 };
    }
    case 'fib': {
      const L = 6;
      const seq = [rng.int(1, 9), rng.int(1, 12)];
      while (seq.length < L + 1) seq.push(seq[seq.length - 1]! + seq[seq.length - 2]!);
      return { family, seq };
    }
  }
}

function scoreNumbers(dr: NumDraft, shown: readonly number[]): { score: number; features: Record<string, number> } {
  const all = dr.seq;
  const maxAbs = Math.max(...all.map(Math.abs));
  const neg = Number(all.some((x) => x < 0));
  const mag = 0.15 * clamp01((Math.log10(maxAbs + 1) - 1) / 3);
  let score = 0;
  switch (dr.family) {
    case 'arith': {
      const d = dr.d!;
      score = 0.02 + (NICE_STEPS.has(Math.abs(d)) ? 0 : 0.08) + (d < 0 ? 0.1 : 0) + 0.12 * neg + (shown.length === 4 ? 0.03 : 0);
      break;
    }
    case 'geom': {
      const r = toNumber(dr.r!);
      const EASE: Record<number, number> = { 2: 0, 10: 0.02, 3: 0.06, 4: 0.08, 5: 0.08 };
      score = 0.3 + (EASE[Math.abs(r)] ?? 0.12) + (r < 0 ? 0.18 : 0) + (isInteger(dr.r!) ? 0 : 0.12);
      break;
    }
    case 'alt':
      score = 0.4 + (dr.d1! * dr.d2! < 0 ? 0.06 : 0) + 0.08 * neg + (Math.max(Math.abs(dr.d1!), Math.abs(dr.d2!)) > 5 ? 0.02 : 0);
      break;
    case 'second':
      score = 0.5 + (Math.abs(dr.c2!) > 1 ? 0.08 : 0) + (dr.c2! < 0 ? 0.08 : 0) + (dr.d0! <= 0 ? 0.06 : 0) + 0.06 * neg;
      break;
    case 'fib':
      score = 0.68 + (all[0]! > all[1]! ? 0.06 : 0);
      break;
  }
  return {
    score: score + mag,
    features: {
      rank: NUM_RANK[dr.family],
      shown: shown.length,
      maxAbs,
      neg,
      dec: Number(all[all.length - 1]! < all[0]!),
    },
  };
}

function sampleNumbers(rng: Rng, band: BandId): Sample {
  const fams: NumberFamily[] = band === 'C' ? FAMILIES : ['arith', 'geom', 'alt', 'second'];
  const within = band === 'C' ? withinC : withinB;
  const draft = sampleUntil<NumDraft>(
    rng,
    (r) => draftFamily(r, band, r.pick(fams)),
    (dr) => {
      if (!within(dr.seq)) return false;
      const puzzle: NumberPattern = { kind: 'numbers', family: dr.family, seq: dr.seq.slice(0, -1) };
      const want = predictNext(dr.family, puzzle.seq);
      return want !== null && eq(want, rat(dr.seq[dr.seq.length - 1]!)) && patternRivals(puzzle).length === 0;
    },
    // Always valid: +2 steps from a small start, five terms shown.
    (r) => {
      const a = r.int(0, 10);
      return { family: 'arith', seq: [a, a + 2, a + 4, a + 6, a + 8, a + 10], d: 2 };
    },
  );
  const seq = draft.seq.slice(0, -1);
  const { score, features } = scoreNumbers(draft, seq);
  return { puzzle: { kind: 'numbers', family: draft.family, seq }, features, score };
}

// ---------------------------------------------------------------- solving and hints

function answerKey(a: PatternAnswer): string {
  return typeof a === 'number' ? `n${a}` : `t${a}`;
}

function solvePattern(p: PatternPuzzle): PatternAnswer[] {
  if (p.kind === 'tiles') {
    const rules = tileRules(p.seq);
    if (rules.length === 0) return [tileIntended(p).next];
    const min = Math.min(...rules.map((r) => r.complexity));
    return uniq(rules.filter((r) => r.complexity === min).map((r) => r.next));
  }
  const fits = FAMILIES.map((f) => ({ f, next: predictNext(f, p.seq) })).filter(
    (x): x is { f: NumberFamily; next: Rational } => x.next !== null && isInteger(x.next),
  );
  if (fits.length === 0) return [];
  const min = Math.min(...fits.map((x) => COMPLEXITY[x.f]));
  return uniq(fits.filter((x) => COMPLEXITY[x.f] === min).map((x) => toNumber(x.next)));
}

const range = (a: number, b: number): string[] => Array.from({ length: b - a + 1 }, (_, i) => `pos:${a + i}`);

function growGroups(p: TilePattern): string[] {
  const out: string[] = [];
  let start = 0;
  for (let g = 1; start < p.seq.length; g++) {
    const end = Math.min(p.seq.length, start + g + 1) - 1;
    out.push(`group:${start}-${end}`);
    start += g + 1;
  }
  return out;
}

function hintPattern(p: PatternPuzzle, tier: number): PuzzleHint | null {
  if (p.kind === 'tiles') {
    const L = p.seq.length;
    if (isGrow(p.family)) {
      const groups = growGroups(p);
      if (tier === 1) return { key: 'puzzle.hint.pattern.groups', params: {}, focus: groups };
      if (tier === 2) return { key: 'puzzle.hint.pattern.grows', params: {}, focus: [...groups.slice(-2), 'next'] };
      return null;
    }
    const q = REPEAT_UNITS[p.family].length;
    if (tier === 1) return { key: 'puzzle.hint.pattern.unit', params: {}, focus: range(0, q - 1) };
    if (tier === 2) return { key: 'puzzle.hint.pattern.same', params: {}, focus: [`pos:${L - q}`, 'next'] };
    return null;
  }
  const seq = p.seq;
  const L = seq.length;
  const last = seq[L - 1]!;
  const next = predictNext(p.family, seq);
  if (!next) return null;
  if (tier === 1) {
    if (p.family === 'geom') return { key: 'puzzle.hint.pattern.ratios', params: {}, focus: ['ratios'] };
    if (p.family === 'fib') return { key: 'puzzle.hint.pattern.neighbours', params: {}, focus: range(0, 2) };
    return { key: 'puzzle.hint.pattern.gaps', params: {}, focus: ['gaps'] };
  }
  if (tier === 2) {
    const d = diffs(seq);
    switch (p.family) {
      case 'arith':
        return { key: 'puzzle.hint.pattern.step', params: { step: d[0]! }, focus: ['gaps'] };
      case 'geom': {
        const r = rat(seq[1]!, seq[0]!);
        return { key: 'puzzle.hint.pattern.ratio', params: { num: r.n, den: r.d }, focus: ['ratios'] };
      }
      case 'alt':
        return { key: 'puzzle.hint.pattern.alternate', params: { first: d[0]!, second: d[1]! }, focus: ['gaps'] };
      case 'second':
        return { key: 'puzzle.hint.pattern.gapGrows', params: { by: d[1]! - d[0]! }, focus: ['gaps'] };
      case 'fib':
        return { key: 'puzzle.hint.pattern.sumTwo', params: {}, focus: range(L - 2, L - 1) };
    }
  }
  if (tier === 3) return { key: 'puzzle.hint.pattern.nextGap', params: { gap: toNumber(sub(next, rat(last))) }, focus: [`pos:${L - 1}`, 'next'] };
  return null;
}

// ---------------------------------------------------------------- definition

const BANDS: readonly BandId[] = ['A', 'B', 'C'];

export const patternPuzzle: PuzzleTypeDef<PatternPuzzle, PatternAnswer> = {
  id: 'pattern',
  version: 1,
  bands: BANDS,

  generate(rng, band, level) {
    assertBand('pattern', BANDS, band);
    const { value, level: achieved } = pickByLevel(
      rng,
      clamp01(level),
      (r) => (band === 'A' ? sampleTiles(r) : sampleNumbers(r, band)),
      (s) => s.score,
    );
    return { puzzle: value.puzzle, achievedLevel: achieved, features: value.features };
  },

  check(p, answer) {
    if (p.kind === 'tiles' ? typeof answer !== 'string' : typeof answer !== 'number' || !Number.isFinite(answer)) {
      return fail(['next']);
    }
    const key = answerKey(answer);
    return solvePattern(p).some((s) => answerKey(s) === key) ? ok() : fail(['next']);
  },

  solve: solvePattern,
  hint: hintPattern,
};
