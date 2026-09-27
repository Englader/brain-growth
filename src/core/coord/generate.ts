/**
 * Coordinate-plane item generator for `geo.coord`: `plot` (tap the lattice
 * point, snap, confirm) or `read` (type x, then y) on a −6…6 plane.
 *
 * Difficulty factors:
 * - quadrant: I is easiest; II and IV have one negative coordinate; III two;
 * - a zero coordinate (a point on an axis) is a classic stumbling block:
 *   (0, 4) gets plotted at (4, 0);
 * - negative values (counted separately from the quadrant, so axis points
 *   with a negative coordinate also score);
 * - range: points far from the origin need more counting;
 * - read is slightly harder than plot (two typed answers, in order).
 *
 * Points with |x| = |y| are never generated: on them a swapped answer is
 * either invisible (x = y) or indistinguishable from a double sign flip
 * (x = −y), so `coord.swapped` would go undetected. The origin is not
 * generated either.
 */
import type { Rng } from '../rng';
import { pickByLevel } from '../items/util';
import { PLANE_MAX, quadrant, type CoordData, type Point } from './point';

export type CoordTask = 'plot' | 'read';

export interface CoordItem {
  task: CoordTask;
  target: Point;
  achievedLevel: number;
  features: Record<string, number>;
}

export function coordFeatures(task: CoordTask, p: Point): Record<string, number> {
  return {
    x: p.x,
    y: p.y,
    read: task === 'read' ? 1 : 0,
    q: quadrant(p),
    zeros: (p.x === 0 ? 1 : 0) + (p.y === 0 ? 1 : 0),
    neg: (p.x < 0 ? 1 : 0) + (p.y < 0 ? 1 : 0),
    maxAbs: Math.max(Math.abs(p.x), Math.abs(p.y)),
  };
}

const QUADRANT_WEIGHT: Record<number, number> = { 0: 0, 1: 0, 2: 0.16, 3: 0.28, 4: 0.18 };

export function scoreCoord(f: Record<string, number>): number {
  const g = (k: string): number => f[k] ?? 0;
  return (
    0.04 +
    0.06 * g('read') +
    (QUADRANT_WEIGHT[g('q')] ?? 0) +
    0.32 * g('zeros') +
    0.2 * g('neg') +
    0.04 * (g('maxAbs') - 1)
  );
}

function samplePoint(r: Rng): Point {
  for (;;) {
    const x = r.int(-PLANE_MAX, PLANE_MAX);
    const y = r.int(-PLANE_MAX, PLANE_MAX);
    if (Math.abs(x) !== Math.abs(y)) return { x: x + 0, y: y + 0 };
  }
}

export function makeCoordItem(rng: Rng, level: number): CoordItem {
  const { value, level: achievedLevel } = pickByLevel(
    rng,
    level,
    (r) => {
      const task: CoordTask = r.chance(0.5) ? 'plot' : 'read';
      const target = samplePoint(r);
      return { task, target, features: coordFeatures(task, target) };
    },
    (c) => scoreCoord(c.features),
    40,
  );
  return { task: value.task, target: value.target, achievedLevel, features: value.features };
}

/** The item payload for `prompt.data` and `answer.check.params`. */
export function coordData(it: CoordItem): CoordData {
  return { x: it.target.x, y: it.target.y, read: it.task === 'read' ? 1 : 0 };
}
