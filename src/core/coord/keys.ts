/**
 * Message keys the coordinate-plane core emits, with their params. The
 * strings live in the locale bundles (the `coord` block, `sol.coord`,
 * `mis.coord`). The point itself is never baked into a message: the mode
 * formats it at render time with the locale's notation (./notation.ts), so a
 * language switch mid-item re-renders it.
 */
import type { SolutionStep } from '../items/types';
import type { CoordTask } from './generate';
import type { Point } from './point';

/** Misconception codes; strings at `mis.<code>.{name,tip}`. */
export const COORD_MIS_KEYS = {
  'coord.swapped': 'mis.coord.swapped',
  'coord.sign': 'mis.coord.sign',
  'coord.offByOne': 'mis.coord.offByOne',
} as const;

/** Worked solution: across, then up/down. */
export const COORD_SOL_KEYS = {
  /** {n, dir: 'left'|'right'|'none'}: "From the origin, go {n} steps right." / "No steps across: stay on the y-axis." (no digit: the hint ladder must not print a coordinate) */
  across: 'sol.coord.across',
  /** {n, dir: 'up'|'down'|'none'}: "Then {n} steps up." / "Stay on the x-axis." */
  upDown: 'sol.coord.upDown',
} as const;

/** Worked steps for a target point: across (x), then up or down (y). */
export function coordSolutionSteps(target: Point): SolutionStep[] {
  const across = target.x === 0 ? 'none' : target.x > 0 ? 'right' : 'left';
  const upDown = target.y === 0 ? 'none' : target.y > 0 ? 'up' : 'down';
  return [
    { k: 'say', key: COORD_SOL_KEYS.across, params: { n: Math.abs(target.x), dir: across } },
    { k: 'say', key: COORD_SOL_KEYS.upDown, params: { n: Math.abs(target.y), dir: upDown } },
  ];
}

/** Which prompt key an item uses. */
export function coordPromptKey(task: CoordTask): 'coord.plot' | 'coord.read' {
  return task === 'plot' ? 'coord.plot' : 'coord.read';
}
