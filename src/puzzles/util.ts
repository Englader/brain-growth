/** Small helpers shared by the puzzle types. Pure and deterministic. */
import type { Rng } from '../core/rng';
import type { BandId } from '../core/types';

export { clamp01, pickByLevel } from '../core/items/util';

export function assertBand(typeId: string, bands: readonly BandId[], band: BandId): void {
  if (!bands.includes(band)) throw new RangeError(`puzzle type ${typeId} is not offered in band ${band}`);
}

/**
 * Draw from `sample` until `accept` holds, at most `tries` times; then return
 * `fallback(rng)`, which must always be acceptable. Keeps generators total
 * and deterministic for every seed.
 */
export function sampleUntil<T>(
  rng: Rng,
  sample: (rng: Rng) => T | null,
  accept: (t: T) => boolean,
  fallback: (rng: Rng) => T,
  tries = 60,
): T {
  for (let i = 0; i < tries; i++) {
    const t = sample(rng);
    if (t !== null && accept(t)) return t;
  }
  return fallback(rng);
}

export const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

/** Smallest number of the form {1,2,5}·10^k that is ≥ x and a multiple of `of`. */
export function niceCeilMultiple(x: number, of = 1): number {
  for (let e = 0; e < 15; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= x && v % of === 0) return v;
    }
  }
  return Math.ceil(x / of) * of;
}

/** Distinct values of a list, first-seen order. */
export function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/** Distinct plain values (compared as canonical JSON), first-seen order. */
export function uniqCanon<T>(xs: readonly T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = canon(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Canonical JSON for de-duplicating plain answers (object keys sorted). */
export function canon(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canon).join(',')}]`;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(x);
}
