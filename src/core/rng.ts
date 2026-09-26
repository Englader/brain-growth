/**
 * Seeded PRNG (sfc32). Every generated item stores its seed in the session log,
 * so any item a child ever saw can be reconstructed bit-for-bit for analysis.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [lo, hi] (inclusive). */
  int(lo: number, hi: number): number;
  /** Random element of a non-empty array. */
  pick<T>(xs: readonly T[]): T;
  /** Standard normal sample (Box-Muller). */
  normal(): number;
  /** Bernoulli trial. */
  chance(p: number): boolean;
  /** Weighted choice; weights need not sum to 1. Returns index. */
  weighted(weights: readonly number[]): number;
  shuffle<T>(xs: readonly T[]): T[];
  /** Derive an independent child generator (for per-item seeds). */
  fork(): { seed: number; rng: Rng };
}

export function createRng(seed: number): Rng {
  let a = 0x9e3779b9 ^ seed;
  let b = 0x243f6a88 ^ Math.imul(seed, 0x85ebca6b);
  let c = 0xb7e15162 ^ Math.imul(seed, 0xc2b2ae35);
  let d = seed | 0;
  const nextU32 = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  // Warm up: sfc32 needs a few rounds to decorrelate from similar seeds.
  for (let i = 0; i < 15; i++) nextU32();

  const rng: Rng = {
    next: () => nextU32() / 4294967296,
    int(lo, hi) {
      if (hi < lo) throw new RangeError(`int(${lo}, ${hi})`);
      return lo + Math.floor(rng.next() * (hi - lo + 1));
    },
    pick(xs) {
      if (xs.length === 0) throw new RangeError('pick from empty array');
      return xs[Math.floor(rng.next() * xs.length)] as (typeof xs)[number];
    },
    normal() {
      const u = Math.max(rng.next(), 1e-12);
      const v = rng.next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    chance: (p) => rng.next() < p,
    weighted(weights) {
      const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
      if (total <= 0) return Math.floor(rng.next() * weights.length);
      let r = rng.next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= Math.max(0, weights[i] ?? 0);
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    shuffle(xs) {
      const out = xs.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
    fork() {
      const seed = nextU32() | 0;
      return { seed, rng: createRng(seed) };
    },
  };
  return rng;
}

/** A seed from the platform CSPRNG when available (not for security, just spread). */
export function freshSeed(): number {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    return crypto.getRandomValues(new Int32Array(1))[0] ?? 0;
  }
  return (Math.random() * 2 ** 31) | 0;
}
