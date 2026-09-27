/**
 * Adapter from the Balance transcript checker to the item checker registry
 * (src/core/items/checkers.ts). Not registered here: the generator module
 * that emits `answer.check = { id: BALANCE_CHECK_ID, params: balanceData(…) }`
 * calls `registerChecker(BALANCE_CHECK_ID, balanceChecker)`.
 *
 * The UI submits `{ kind: 'built', value, repr }` with `repr` the transcript
 * (see ./check.ts); `value` is ignored, the typed value is read from `repr`.
 */
import type { Checker } from '../items/checkers';
import { sub, toNumber } from '../rational';
import { checkBalance } from './check';

export const BALANCE_CHECK_ID = 'balance.eq';
/** `prompt: { kind: 'custom', type: BALANCE_PROMPT_TYPE, data: balanceData(…) }`. */
export const BALANCE_PROMPT_TYPE = 'balance.eq';

export const balanceChecker: Checker = (_item, response, params) => {
  if (response.kind !== 'built') return { correct: false, invalid: true, given: '' };
  const r = checkBalance(params, response.repr);
  return {
    correct: r.ok,
    invalid: r.reason === 'parse',
    given: r.given,
    misconception: r.misconception,
    delta: r.value && r.solution ? toNumber(sub(r.value, r.solution)) : null,
  };
};
