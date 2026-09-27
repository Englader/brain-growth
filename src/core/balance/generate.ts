/**
 * Balance equation generator for `al.eq.onestep` and `al.eq.linear`.
 *
 * Every equation is built backwards from an integer solution s, so it always
 * has exactly one solution and that solution is an integer. The sampler is
 * level-agnostic; `pickByLevel` keeps the candidate whose scored difficulty is
 * closest to the requested level (the project's sampler/scorer convention).
 *
 * Difficulty factors (scored per skill, so each skill spans its own [0,1]):
 * - one step (x + b = d, a·x = d) vs two steps (a·x + b = d) vs x on both
 *   sides (a·x + b = c·x + d, usually three moves);
 * - division needed (a·x = d is harder than x + b = d);
 * - x on the right-hand pan only (d = a·x + b reads backwards);
 * - negative coefficients (x-balloons) and negative constants (balloons);
 * - coefficient size;
 * - solution sign and size.
 */
import type { Rng } from '../rng';
import { pickByLevel } from '../items/util';
import { coefs, eqn, needsBalloons, solveEquation, type Equation } from './equation';
import { solutionPath, type BalanceMove } from './moves';

export type BalanceSkill = 'al.eq.onestep' | 'al.eq.linear';

export interface MadeEquation {
  eq: Equation;
  /** The integer solution. */
  solution: number;
  /** Achieved difficulty on the skill's [0,1] scale. */
  achievedLevel: number;
  /** Raw difficulty features (logged so the scorer can be re-fitted). */
  features: Record<string, number>;
  /** The scale shows balloons (negative amounts) for this equation. */
  balloons: boolean;
  /** Shortest balanced path to x alone (see `solutionPath`). */
  path: BalanceMove[];
}

/** Bounds the sampler keeps to, so every scale stays drawable. */
export const BALANCE_LIMITS = {
  onestep: { maxSolution: 20, maxCoef: 10, maxConst: 40 },
  linear: { maxSolution: 12, maxCoef: 9, maxConst: 60 },
} as const;

/** Signed magnitude in [1, cap], negative with probability `pNeg`. */
const signed = (r: Rng, cap: number, pNeg: number): number => (r.chance(pNeg) ? -1 : 1) * r.int(1, cap);

/** "0 = 6x − 18": an empty pan reads badly on the scale, so the samplers skip it. */
export function hasEmptyPan(e: Equation): boolean {
  return (e.l.x === 0 && e.l.k === 0) || (e.r.x === 0 && e.r.k === 0);
}

function swapSides(e: Equation): Equation {
  return { l: e.r, r: e.l };
}

function sampleOneStep(r: Rng): Equation {
  const L = BALANCE_LIMITS.onestep;
  for (let tries = 0; tries < 50; tries++) {
    const cap = r.pick([5, 10, L.maxSolution]);
    const s = signed(r, cap, 0.4);
    let e: Equation;
    if (r.chance(0.5)) {
      // x + b = d
      const b = signed(r, Math.min(cap, 20), 0.35);
      e = eqn(1, b, 0, s + b);
    } else {
      // a·x = d, a ∉ {0, 1}
      const a = r.chance(0.3) ? -r.int(1, L.maxCoef) : r.int(2, L.maxCoef);
      e = eqn(a, 0, 0, a * s);
    }
    if (r.chance(0.25)) e = swapSides(e);
    if (Math.max(...coefs(e).map(Math.abs)) <= L.maxConst && !hasEmptyPan(e)) return e;
  }
  return eqn(1, 2, 0, 5);
}

function sampleLinear(r: Rng): Equation {
  const L = BALANCE_LIMITS.linear;
  for (let tries = 0; tries < 50; tries++) {
    const cap = r.pick([5, 8, L.maxSolution]);
    const s = signed(r, cap, 0.35);
    let e: Equation;
    if (r.chance(0.5)) {
      // a·x + b = d (two steps), a ∉ {0, 1}
      const a = r.chance(0.25) ? -r.int(1, L.maxCoef) : r.int(2, L.maxCoef);
      const b = signed(r, 20, 0.35);
      e = eqn(a, b, 0, a * s + b);
      if (r.chance(0.25)) e = swapSides(e);
    } else {
      // a·x + b = c·x + d (x on both sides), a ≠ c
      const a = r.chance(0.2) ? -r.int(1, L.maxCoef) : r.int(1, L.maxCoef);
      const c = r.chance(0.2) ? -r.int(1, L.maxCoef) : r.int(1, L.maxCoef);
      if (c === a) continue;
      const b = r.chance(0.15) ? 0 : signed(r, 20, 0.35);
      e = eqn(a, b, c, (a - c) * s + b);
    }
    const [a, b, c, d] = coefs(e);
    if (Math.max(Math.abs(a), Math.abs(c)) > L.maxCoef) continue;
    if (Math.max(Math.abs(b), Math.abs(d)) > L.maxConst || hasEmptyPan(e)) continue;
    return e;
  }
  return eqn(2, 1, 0, 7);
}

/** Raw features of an equation (and its shortest path). */
export function equationFeatures(eq: Equation, path: readonly BalanceMove[]): Record<string, number> {
  const [a, b, c, d] = coefs(eq);
  const s = solveEquation(eq)!;
  return {
    a,
    b,
    c,
    d,
    x: s.n,
    steps: path.length,
    bothSides: a !== 0 && c !== 0 ? 1 : 0,
    xRight: a === 0 ? 1 : 0,
    div: path.some((m) => m.op === 'div') ? 1 : 0,
    negCoef: [a, c].filter((v) => v < 0).length,
    negConst: [b, d].filter((v) => v < 0).length,
    maxCoef: Math.max(Math.abs(a), Math.abs(c)),
    maxConst: Math.max(Math.abs(b), Math.abs(d)),
    solNeg: s.n < 0 ? 1 : 0,
    solAbs: Math.abs(s.n),
  };
}

/** Hand-built difficulty scorers; the logged features let them be re-fitted. */
export function scoreEquation(skill: BalanceSkill, f: Record<string, number>): number {
  const g = (k: string): number => f[k] ?? 0;
  if (skill === 'al.eq.onestep') {
    return (
      0.03 +
      0.18 * g('div') +
      0.08 * g('xRight') +
      0.14 * (g('negConst') > 0 ? 1 : 0) +
      0.22 * (g('negCoef') > 0 ? 1 : 0) +
      0.02 * (g('maxCoef') - 1) +
      0.19 * g('solNeg') +
      0.01 * g('solAbs') +
      0.002 * g('maxConst')
    );
  }
  return (
    0.02 +
    0.26 * g('bothSides') +
    0.06 * (g('steps') >= 3 ? 1 : 0) +
    0.06 * g('xRight') +
    0.12 * (g('negConst') > 0 ? 1 : 0) +
    0.2 * (g('negCoef') > 0 ? 1 : 0) +
    0.015 * (g('maxCoef') - 2) +
    0.16 * g('solNeg') +
    0.012 * g('solAbs') +
    0.002 * g('maxConst')
  );
}

export function makeEquation(rng: Rng, skill: BalanceSkill, level: number): MadeEquation {
  const sample = skill === 'al.eq.onestep' ? sampleOneStep : sampleLinear;
  const { value, level: achievedLevel } = pickByLevel(
    rng,
    level,
    (r) => {
      const eq = sample(r);
      const balloons = needsBalloons(eq);
      const path = solutionPath(eq, balloons) ?? [];
      return { eq, balloons, path, features: equationFeatures(eq, path) };
    },
    (c) => scoreEquation(skill, c.features),
    40,
  );
  const s = solveEquation(value.eq)!;
  return {
    eq: value.eq,
    solution: s.n,
    achievedLevel,
    features: value.features,
    balloons: value.balloons,
    path: value.path,
  };
}
