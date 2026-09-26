/**
 * Exact rational arithmetic for answers. Floats are never used to decide
 * correctness: 0.1 + 0.2 must equal 0.3 for a child.
 * Magnitudes in school maths stay far below 2^53, so plain numbers suffice.
 */
export interface Rational {
  readonly n: number;
  readonly d: number; // always > 0, gcd(|n|, d) === 1
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function rat(n: number, d = 1): Rational {
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    throw new RangeError(`rat() needs integers, got ${n}/${d}`);
  }
  if (d === 0) throw new RangeError('zero denominator');
  const s = d < 0 ? -1 : 1;
  const g = gcd(n, d);
  // `+ 0` normalises -0 to 0 so equality and JSON are stable.
  return { n: (s * n) / g + 0, d: Math.abs(d) / g };
}

export const ZERO = rat(0);

export function add(a: Rational, b: Rational): Rational {
  return rat(a.n * b.d + b.n * a.d, a.d * b.d);
}
export function sub(a: Rational, b: Rational): Rational {
  return rat(a.n * b.d - b.n * a.d, a.d * b.d);
}
export function mul(a: Rational, b: Rational): Rational {
  return rat(a.n * b.n, a.d * b.d);
}
export function div(a: Rational, b: Rational): Rational {
  if (b.n === 0) throw new RangeError('division by zero');
  return rat(a.n * b.d, a.d * b.n);
}
export function neg(a: Rational): Rational {
  return rat(-a.n, a.d);
}
export function eq(a: Rational, b: Rational): boolean {
  return a.n === b.n && a.d === b.d;
}
export function cmp(a: Rational, b: Rational): number {
  return Math.sign(a.n * b.d - b.n * a.d);
}
export function toNumber(a: Rational): number {
  return a.n / a.d;
}
export function isInteger(a: Rational): boolean {
  return a.d === 1;
}
export function abs(a: Rational): Rational {
  return rat(Math.abs(a.n), a.d);
}

/** Exact conversion of a finite decimal string like "-12.305" (dot decimal). */
export function fromDecimalString(s: string): Rational {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new RangeError(`not a decimal: ${s}`);
  const sign = m[1] === '-' ? -1 : 1;
  const intPart = m[2] || '0';
  const frac = m[3] ?? '';
  const d = 10 ** frac.length;
  return rat(sign * (Number(intPart) * d + (frac ? Number(frac) : 0)), d);
}

/** Integer or terminating-decimal number to Rational (e.g. 3.25 -> 13/4). */
export function fromNumber(x: number): Rational {
  if (Number.isInteger(x)) return rat(x);
  // Limit to 9 decimals: generators never produce more.
  const s = x.toFixed(9).replace(/0+$/, '');
  return fromDecimalString(s);
}

/** True when the rational has a finite decimal expansion (denominator 2^a 5^b). */
export function isTerminatingDecimal(a: Rational): boolean {
  let d = a.d;
  while (d % 2 === 0) d /= 2;
  while (d % 5 === 0) d /= 5;
  return d === 1;
}

/** Stable string key, e.g. "3/4" or "-7". Used in logs. */
export function key(a: Rational): string {
  return a.d === 1 ? String(a.n) : `${a.n}/${a.d}`;
}

export function parseKey(s: string): Rational {
  const [n, d] = s.split('/');
  return rat(Number(n), d === undefined ? 1 : Number(d));
}
