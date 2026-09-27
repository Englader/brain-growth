/**
 * Adapters from the Workshop checkers to the item checker registry
 * (src/core/items/checkers.ts). Not registered here: the generator module
 * calls `registerChecker(FRAC_BAR_CHECK_ID, fracBarChecker)` and
 * `registerChecker(RECT_CHECK_ID, rectChecker)`.
 *
 * The UI submits `{ kind: 'built', value, repr }`: repr "6|0,2,4" for a bar
 * (./fracbar.ts), "4x6" for a rectangle (./rect.ts). `value` is ignored.
 */
import type { Checker } from '../items/checkers';
import { rat, sub, toNumber } from '../rational';
import { checkFracBarRepr, readFracBarData } from './fracbar';
import { checkRectRepr } from './rect';

export const FRAC_BAR_CHECK_ID = 'workshop.frac';
export const RECT_CHECK_ID = 'workshop.rect';
/** Custom prompt types, `data` = `fracBarData(…)` / `rectData(…)`. */
export const FRAC_BAR_PROMPT_TYPE = 'workshop.frac';
export const RECT_PROMPT_TYPE = 'workshop.rect';

export const fracBarChecker: Checker = (_item, response, params) => {
  if (response.kind !== 'built') return { correct: false, invalid: true, given: '' };
  const r = checkFracBarRepr(params, response.repr);
  const t = readFracBarData(params);
  return {
    correct: r.ok,
    invalid: r.invalid,
    given: r.given,
    misconception: r.misconception,
    delta: r.amount && t ? toNumber(sub(r.amount, rat(t.n, t.d))) : null,
  };
};

export const rectChecker: Checker = (_item, response, params) => {
  if (response.kind !== 'built') return { correct: false, invalid: true, given: '' };
  const r = checkRectRepr(params, response.repr);
  return { correct: r.ok, invalid: r.invalid, given: r.given, misconception: r.misconception, delta: null };
};
