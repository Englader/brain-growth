import type { Rng } from '../rng';
import type { Expr, Op } from './types';

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const clamp01 = (x: number): number => clamp(x, 0, 1);

/**
 * Difficulty control for procedural generators.
 *
 * Each generator is a (sampler, scorer) pair: the sampler proposes random
 * parameterisations, the scorer maps parameters to a difficulty in [0,1]
 * using known difficulty factors (problem size, bridging ten, number of
 * regroupings, table difficulty…). We draw k candidates and keep one close to
 * the requested level, choosing randomly among near-ties so the same level does
 * not always yield the same item. The scorer is hand-built today; the logged
 * `features` make it refittable from real data later.
 */
export function pickByLevel<T>(
  rng: Rng,
  target: number,
  sample: (rng: Rng) => T,
  score: (t: T) => number,
  k = 32,
): { value: T; level: number } {
  const cands: Array<{ value: T; level: number; dist: number }> = [];
  for (let i = 0; i < k; i++) {
    const value = sample(rng);
    const level = clamp01(score(value));
    cands.push({ value, level, dist: Math.abs(level - target) });
  }
  const best = Math.min(...cands.map((c) => c.dist));
  const near = cands.filter((c) => c.dist <= best + 0.04);
  const chosen = rng.pick(near);
  return { value: chosen.value, level: chosen.level };
}

export const num = (v: number): Expr => ({ k: 'num', v });
export const bin = (op: Op, a: number | Expr, b: number | Expr): Expr => ({
  k: 'op',
  op,
  a: typeof a === 'number' ? num(a) : a,
  b: typeof b === 'number' ? num(b) : b,
});
export const BLANK: Expr = { k: 'blank' };
/** A fraction as written (never reduced): frac(6, 8) shows 6/8. `n = null` is a blank numerator. */
export const frac = (n: number | null, d: number): Expr => ({ k: 'frac', n, d });

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
export const lcm = (a: number, b: number): number => (a && b ? Math.abs(a * b) / gcd(a, b) : 0);

/** Evaluate an expression with no blanks (tests use this to verify answers). */
export function evalExpr(e: Expr): number {
  switch (e.k) {
    case 'num':
      return e.v;
    case 'frac':
      if (e.n === null) throw new Error('cannot evaluate a blank numerator');
      return e.n / e.d;
    case 'blank':
      throw new Error('cannot evaluate blank');
    case 'op': {
      const a = evalExpr(e.a);
      const b = evalExpr(e.b);
      switch (e.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
      }
    }
  }
}

export const digits = (n: number): number[] => String(Math.abs(n)).split('').map(Number);
export const ones = (n: number): number => Math.abs(n) % 10;
export const tens = (n: number): number => Math.floor(Math.abs(n) / 10) % 10;
export const hundreds = (n: number): number => Math.floor(Math.abs(n) / 100) % 10;

/** Number of carries in column addition a + b. */
export function carries(a: number, b: number): number {
  let c = 0;
  let carry = 0;
  while (a > 0 || b > 0) {
    const s = (a % 10) + (b % 10) + carry;
    carry = s >= 10 ? 1 : 0;
    c += carry;
    a = Math.floor(a / 10);
    b = Math.floor(b / 10);
  }
  return c;
}

/** Number of borrows in column subtraction a - b (a >= b), and whether any crosses a zero. */
export function borrows(a: number, b: number): { count: number; acrossZero: boolean } {
  let count = 0;
  let borrow = 0;
  let acrossZero = false;
  while (a > 0 || b > 0) {
    let da = (a % 10) - borrow;
    const db = b % 10;
    if (da < db) {
      if (a % 10 === 0 && borrow) acrossZero = true;
      da += 10;
      borrow = 1;
      count++;
    } else borrow = 0;
    if (da < 0) acrossZero = true;
    a = Math.floor(a / 10);
    b = Math.floor(b / 10);
  }
  return { count, acrossZero };
}

/** Column addition that forgets every carry (misconception model). */
export function addNoCarry(a: number, b: number): number {
  let out = 0;
  let place = 1;
  while (a > 0 || b > 0) {
    out += (((a % 10) + (b % 10)) % 10) * place;
    place *= 10;
    a = Math.floor(a / 10);
    b = Math.floor(b / 10);
  }
  return out;
}

/** "Smaller-from-larger" subtraction bug: each column |x - y|. */
export function subSmallerFromLarger(a: number, b: number): number {
  let out = 0;
  let place = 1;
  while (a > 0 || b > 0) {
    out += Math.abs((a % 10) - (b % 10)) * place;
    place *= 10;
    a = Math.floor(a / 10);
    b = Math.floor(b / 10);
  }
  return out;
}

/** Borrow performed in a column but the next column is not decremented. */
export function subBorrowNoDecrement(a: number, b: number): number {
  let out = 0;
  let place = 1;
  while (a > 0 || b > 0) {
    let da = a % 10;
    const db = b % 10;
    if (da < db) da += 10;
    out += (da - db) * place;
    place *= 10;
    a = Math.floor(a / 10);
    b = Math.floor(b / 10);
  }
  return out;
}

/** Nice window [lo, hi] on multiples of `unit` containing all values, at least `minWidth` wide. */
export function windowAround(values: number[], unit: number, minWidth: number, floor = 0): [number, number] {
  let lo = Math.floor(Math.min(...values) / unit) * unit;
  let hi = Math.ceil(Math.max(...values) / unit) * unit;
  if (hi === lo) hi += unit;
  while (hi - lo < minWidth) {
    if (lo - unit >= floor && (hi - lo) % (2 * unit) === 0) lo -= unit;
    else hi += unit;
  }
  return [Math.max(floor, lo), hi];
}

export function uniqMisconceptions(
  list: Array<{ value: number; code: string }>,
  correct: number,
): Array<{ value: number; code: string }> {
  const seen = new Set<number>([correct]);
  const out: Array<{ value: number; code: string }> = [];
  for (const m of list) {
    if (!Number.isFinite(m.value) || seen.has(m.value)) continue;
    seen.add(m.value);
    out.push(m);
  }
  return out;
}
