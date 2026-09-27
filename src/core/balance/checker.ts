/**
 * Adapter from the Balance transcript checker to the item checker registry
 * (src/core/items/checkers.ts). Registered once by the equation generator
 * (src/core/items/generators/equation.ts).
 *
 * The UI submits `{ kind: 'built', value, repr, data: { bal } }` with `repr`
 * the transcript (see ./check.ts); `value` is ignored, the typed value is
 * read from `repr`. `data.bal = 1` says the scale showed balloons (every
 * Band C scale does, even for an all-positive equation): the replay then
 * allows negative amounts too. That flag is presentation, not correctness:
 * it can only turn a `negative` refusal into a legal move, and a legal move
 * never makes a wrong value right.
 */
import type { Checker } from '../items/checkers';
import { sub, toNumber } from '../rational';
import { checkBalance } from './check';

export const BALANCE_CHECK_ID = 'balance.eq';
/** `prompt: { kind: 'custom', type: BALANCE_PROMPT_TYPE, data: balanceData(…) }`. */
export const BALANCE_PROMPT_TYPE = 'balance.eq';

export const balanceChecker: Checker = (_item, response, params) => {
  if (response.kind !== 'built') return { correct: false, invalid: true, given: '' };
  const bal = params.bal === 1 || response.data?.bal === 1 ? 1 : 0;
  const r = checkBalance({ ...params, bal }, response.repr);
  return {
    correct: r.ok,
    invalid: r.reason === 'parse',
    given: r.given,
    misconception: r.misconception,
    delta: r.value && r.solution ? toNumber(sub(r.value, r.solution)) : null,
  };
};
