/**
 * Adapter from the point checker to the item checker registry
 * (src/core/items/checkers.ts). Not registered here: the generator module
 * that emits `answer.check = { id: COORD_CHECK_ID, params: { x, y, read } }`
 * calls `registerChecker(COORD_CHECK_ID, coordChecker)`.
 *
 * Both tasks submit `{ kind: 'built', value: null, repr: "x,y" }` (plot: the
 * confirmed snapped point; read: the two typed numbers).
 */
import type { Checker } from '../items/checkers';
import { checkCoord } from './point';

export const COORD_CHECK_ID = 'coord.point';
/** `prompt: { kind: 'custom', type: COORD_PROMPT_TYPE, data: { x, y, read } }`. */
export const COORD_PROMPT_TYPE = 'coord.point';

export const coordChecker: Checker = (_item, response, params) => {
  if (response.kind !== 'built') return { correct: false, invalid: true, given: '' };
  const r = checkCoord(params, response.repr);
  return { correct: r.ok, invalid: r.invalid, given: r.given, misconception: r.misconception, delta: null };
};
