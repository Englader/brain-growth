/**
 * Message keys the coordinate-plane mode needs, with their params. The strings
 * live in the locale bundles (the `coord` block, `sol.coord`, `mis.coord`);
 * the core itself emits only the `sol.coord.*` steps and misconception codes.
 */
import type { SolutionStep } from '../items/types';
import type { CoordTask } from './generate';
import type { Point } from './point';

/** Misconception codes; strings at `mis.<code>.{name,tip}`. */
export const COORD_MIS_KEYS = {
  'coord.swapped': 'mis.coord.swapped', // "Swapped x and y" / "Across first (x), then up or down (y)."
  'coord.sign': 'mis.coord.sign', // "Went the wrong way on an axis" / "Minus x is left of 0; minus y is below 0."
  'coord.offByOne': 'mis.coord.offByOne', // "One step off" / "Start counting from 0, not 1."
} as const;

/** Worked solution: across, then up/down. */
export const COORD_SOL_KEYS = {
  /** {n, dir: 'left'|'right'|'none'}: "Go {n} steps to the right from 0." / "Stay on the y-axis." */
  across: 'sol.coord.across',
  /** {n, dir: 'up'|'down'|'none'}: "Then {n} steps up." / "Stay on the x-axis." */
  upDown: 'sol.coord.upDown',
  /**
   * {x, y}: "That is ({x}, {y})." Numbers, not a formatted point, because
   * solution steps are stored in the item and must re-render on a language
   * switch; each locale's template writes its own notation (both use a comma
   * for integer points, see ./notation.ts).
   */
  result: 'sol.coord.result',
} as const;

/** `coord.*` UI strings. */
export const COORD_UI_KEYS = [
  'coord.title',
  'coord.flag',
  'coord.plot', // {point}: "Put a dot at {point}." (the prompt renderer formats with formatPoint at render time)
  'coord.read', // "Where is the dot? Type x, then y."
  'coord.x', // label of the x field
  'coord.y', // label of the y field
  'coord.confirm', // confirm the snapped point
] as const;

/** Worked steps for a target point: across, then up or down, then the point. */
export function coordSolutionSteps(target: Point): SolutionStep[] {
  const across = target.x === 0 ? 'none' : target.x > 0 ? 'right' : 'left';
  const upDown = target.y === 0 ? 'none' : target.y > 0 ? 'up' : 'down';
  return [
    { k: 'say', key: COORD_SOL_KEYS.across, params: { n: Math.abs(target.x), dir: across } },
    { k: 'say', key: COORD_SOL_KEYS.upDown, params: { n: Math.abs(target.y), dir: upDown } },
    { k: 'say', key: COORD_SOL_KEYS.result, params: { x: target.x, y: target.y } },
  ];
}

/** Which prompt key an item uses. */
export function coordPromptKey(task: CoordTask): string {
  return task === 'plot' ? 'coord.plot' : 'coord.read';
}
