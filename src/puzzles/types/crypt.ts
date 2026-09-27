/**
 * Cryptarithms (C): column additions such as AB + BA = CDC where every symbol
 * stands for a digit. Symbols are abstract ids `s0`…`s9` that the UI draws as
 * shapes, so the puzzle is language-neutral. Rules: different symbols are
 * different digits, the same symbol is always the same digit, and no word
 * starts with 0.
 *
 * Generation starts from a real addition whose digits come from a small pool
 * (so symbols repeat, as in good cryptarithms), then gives away digits
 * (`given`) until exactly one assignment remains. The level mostly reflects
 * how many symbols are left to find, plus columns, carries and addends.
 * The checker accepts ANY assignment that satisfies the rules, so a puzzle
 * with several solutions (hand-made or future content) is still fair.
 *
 * Violated constraint ids: `missing:<sym>` (no digit 0–9 entered),
 * `distinct:<sym>` (shares its digit with another symbol), `lead:<sym>`
 * (a word starts with 0), `col:<i>` (column i, counted from the right with
 * units = 0, does not add up with the entered digits; the top column is also
 * reported when the addition overflows the sum).
 * Focus ids in hints: `sym:<id>`, `col:<i>`.
 */
import type { Rng } from '../../core/rng';
import type { BandId } from '../../core/types';
import { fail, ok, type CheckResult, type PuzzleHint, type PuzzleTypeDef } from '../types';
import { assertBand, clamp01, isInt, pickByLevel, uniq, uniqCanon } from '../util';

export const SYMBOL_IDS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'] as const;

export interface CryptPuzzle {
  /** Words to add, each most-significant symbol first. */
  addends: string[][];
  sum: string[];
  /** Distinct symbols, in reading order (addends then sum, left to right). */
  symbols: string[];
  /** Digits given away; shown filled in and fixed. */
  given: Record<string, number>;
}
/** Digit per symbol. Given symbols may be omitted (the puzzle's value is used). */
export type CryptAnswer = Record<string, number>;

const words = (p: CryptPuzzle): string[][] => [...p.addends, p.sum];
const leadingSymbols = (p: CryptPuzzle): Set<string> => new Set(words(p).map((w) => w[0]!));

interface Column {
  add: string[];
  res: string;
}

function columns(p: CryptPuzzle): Column[] {
  const L = p.sum.length;
  return Array.from({ length: L }, (_, c) => ({
    add: p.addends.map((w) => w[w.length - 1 - c]).filter((s): s is string => s !== undefined),
    res: p.sum[L - 1 - c]!,
  }));
}

/**
 * Every assignment satisfying the rules and the givens, up to `limit`.
 * Column-wise backtracking from the units column: addend symbols are tried,
 * then the sum symbol is forced by the column total.
 */
export function cryptSolutions(p: CryptPuzzle, limit = 200): Record<string, number>[] {
  const cols = columns(p);
  const lead = leadingSymbols(p);
  const val = new Map<string, number>();
  const used = new Set<number>();
  for (const [s, d] of Object.entries(p.given)) {
    if (used.has(d) || (d === 0 && lead.has(s))) return [];
    val.set(s, d);
    used.add(d);
  }
  const out: Record<string, number>[] = [];
  const tryAssign = (s: string, d: number): boolean => !used.has(d) && !(d === 0 && lead.has(s));
  const rec = (c: number, carry: number, i: number): void => {
    if (out.length >= limit) return;
    if (c === cols.length) {
      if (carry === 0) out.push(Object.fromEntries(p.symbols.map((s) => [s, val.get(s)!])));
      return;
    }
    const col = cols[c]!;
    if (i < col.add.length) {
      const s = col.add[i]!;
      if (val.has(s)) return rec(c, carry, i + 1);
      for (let d = 0; d <= 9; d++) {
        if (!tryAssign(s, d)) continue;
        val.set(s, d);
        used.add(d);
        rec(c, carry, i + 1);
        val.delete(s);
        used.delete(d);
      }
      return;
    }
    const total = carry + col.add.reduce((t, s) => t + val.get(s)!, 0);
    const digit = total % 10;
    const next = Math.floor(total / 10);
    const have = val.get(col.res);
    if (have !== undefined) {
      if (have === digit) rec(c + 1, next, 0);
      return;
    }
    if (!tryAssign(col.res, digit)) return;
    val.set(col.res, digit);
    used.add(digit);
    rec(c + 1, next, 0);
    val.delete(col.res);
    used.delete(digit);
  };
  rec(0, 0, 0);
  return out;
}

function carriesOf(nums: readonly number[]): number {
  let carry = 0;
  let count = 0;
  const maxLen = Math.max(...nums.map((n) => String(n).length));
  for (let c = 0; c < maxLen; c++) {
    const t = carry + nums.reduce((s, n) => s + (Math.floor(n / 10 ** c) % 10), 0);
    carry = Math.floor(t / 10);
    if (carry) count++;
  }
  return count;
}

// ---------------------------------------------------------------- generation

interface Sample {
  puzzle: CryptPuzzle;
  features: Record<string, number>;
  score: number;
}

/** `level` only biases the size of what is drawn; the scorer decides the achieved level. */
function sampleCrypt(rng: Rng, level: number): Sample {
  for (let attempt = 0; ; attempt++) {
    const nAdd = rng.chance(0.2) ? 3 : 2;
    const lens = Array.from({ length: nAdd }, () => rng.pick(nAdd === 3 ? [2, 2, 3] : level > 0.5 ? [2, 3, 3, 4] : [2, 2, 3]));
    const pool = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, rng.int(3, 4 + Math.round(3 * level)));
    const nums = lens.map((len) => {
      const ds = Array.from({ length: len }, () => rng.pick(pool));
      if (ds[0] === 0) ds[0] = rng.pick(pool.filter((d) => d !== 0));
      return Number(ds.join(''));
    });
    const total = nums.reduce((a, b) => a + b, 0);
    const toSym = new Map<number, string>();
    const perm = rng.shuffle(SYMBOL_IDS);
    const enc = (n: number): string[] =>
      String(n)
        .split('')
        .map(Number)
        .map((d) => {
          if (!toSym.has(d)) toSym.set(d, perm[toSym.size]!);
          return toSym.get(d)!;
        });
    const addends = nums.map(enc);
    const sum = enc(total);
    const symbols = uniq([...addends.flat(), ...sum]);
    const truth = Object.fromEntries([...toSym].map(([d, s]) => [s, d]));
    let puzzle: CryptPuzzle = { addends, sum, symbols, given: {} };
    const FREE_CAP = 1000;
    let sols = cryptSolutions(puzzle, FREE_CAP);
    const free = sols.length;
    while (sols.length > 1) {
      // Give away the symbol that varies most across the remaining solutions.
      const open = symbols.filter((s) => !(s in puzzle.given));
      const spread = open.map((s) => new Set(sols.map((x) => x[s])).size);
      const best = Math.max(...spread);
      const s = rng.pick(open.filter((_, i) => spread[i] === best));
      puzzle = { ...puzzle, given: { ...puzzle.given, [s]: truth[s]! } };
      sols = sols.length >= FREE_CAP ? cryptSolutions(puzzle, FREE_CAP) : sols.filter((x) => x[s] === truth[s]);
    }
    const givens = Object.keys(puzzle.given).length;
    const unknowns = symbols.length - givens;
    if (unknowns < 2 && attempt < 40) continue; // keep at least two symbols to find when possible
    const carries = carriesOf(nums);
    const cols = sum.length;
    return {
      puzzle,
      features: { symbols: symbols.length, givens, unknowns, columns: cols, carries, addends: nAdd, free },
      score: 0.14 * (unknowns - 2) + 0.05 * carries + 0.04 * (cols - 2) + 0.05 * (nAdd - 2) + (givens === 0 ? 0.08 : 0),
    };
  }
}

// ---------------------------------------------------------------- checking, solving, hints

function checkCrypt(p: CryptPuzzle, answer: CryptAnswer): CheckResult {
  const v: Record<string, number> = { ...(answer ?? {}), ...p.given };
  const violated: string[] = [];
  const valid = (s: string): boolean => isInt(v[s]) && v[s]! >= 0 && v[s]! <= 9;
  const missing = p.symbols.filter((s) => !valid(s));
  for (const s of missing) violated.push(`missing:${s}`);
  const present = p.symbols.filter(valid);
  for (const s of present) if (present.some((t) => t !== s && v[t] === v[s])) violated.push(`distinct:${s}`);
  for (const s of leadingSymbols(p)) if (valid(s) && v[s] === 0) violated.push(`lead:${s}`);
  if (missing.length === 0) {
    const cols = columns(p);
    let carry = 0;
    cols.forEach((col, c) => {
      const t = carry + col.add.reduce((a, s) => a + v[s]!, 0);
      if (t % 10 !== v[col.res]) violated.push(`col:${c}`);
      carry = Math.floor(t / 10);
    });
    if (carry > 0) violated.push(`col:${cols.length - 1}`);
  }
  return violated.length ? fail(uniq(violated)) : ok();
}

function solveCrypt(p: CryptPuzzle): CryptAnswer[] {
  return uniqCanon(cryptSolutions(p));
}

function hintCrypt(p: CryptPuzzle, tier: number): PuzzleHint | null {
  const sol = cryptSolutions(p, 1)[0];
  if (!sol) return null;
  const L = p.sum.length;
  const top = p.sum[0]!;
  // A sum longer than every addend starts with the final carry, which is always 1.
  const carryHint = L > Math.max(...p.addends.map((w) => w.length)) && !(top in p.given);
  if (tier === 1) {
    if (carryHint) return { key: 'puzzle.hint.crypt.carry', params: { sym: top }, focus: [`sym:${top}`, `col:${L - 1}`] };
    return { key: 'puzzle.hint.crypt.units', params: {}, focus: ['col:0'] };
  }
  // Then reveal unknown symbols column by column from the units (the carried 1 is already told).
  const order = uniq(columns(p).flatMap((c) => [...c.add, c.res])).filter((s) => !(s in p.given) && !(carryHint && s === top));
  const i = tier - 2;
  if (tier > 3 || i >= order.length - 1) return null;
  const sym = order[i]!;
  return { key: 'puzzle.hint.crypt.reveal', params: { sym, digit: sol[sym]! }, focus: [`sym:${sym}`] };
}

// ---------------------------------------------------------------- definition

const BANDS: readonly BandId[] = ['C'];

export const cryptPuzzle: PuzzleTypeDef<CryptPuzzle, CryptAnswer> = {
  id: 'crypt',
  version: 1,
  bands: BANDS,

  generate(rng, band, level) {
    assertBand('crypt', BANDS, band);
    const target = clamp01(level);
    const { value, level: achieved } = pickByLevel(rng, target, (r) => sampleCrypt(r, target), (s) => s.score, 16);
    return { puzzle: value.puzzle, achievedLevel: achieved, features: value.features };
  },

  check: checkCrypt,
  solve: solveCrypt,
  hint: hintCrypt,
};
