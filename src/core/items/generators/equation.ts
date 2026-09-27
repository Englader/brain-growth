/**
 * `equation` (capability 'build', step 9b): a Balance item for
 * `al.eq.onestep` or `al.eq.linear` (config `{ skill }`). The child balances
 * the scale until x stands alone and types its value; the item is graded by
 * the `balance.eq` checker, which replays the move transcript
 * (src/core/balance).
 *
 * Loaded on demand with the Balance mode (ON_DEMAND in ./index.ts); Hop's
 * binding for the same skill is ./eqBond.ts, which stays eager. This module
 * registers the `balance.eq` checker and custom prompt once, when it loads.
 */
import { balanceData, balanceMisconceptions, balanceSolutionSteps, readBalanceData } from '../../balance/check';
import { BALANCE_CHECK_ID, BALANCE_PROMPT_TYPE, balanceChecker } from '../../balance/checker';
import { solveEquation } from '../../balance/equation';
import { makeEquation, type BalanceSkill } from '../../balance/generate';
import { t } from '../../../i18n/i18n';
import { key, rat } from '../../rational';
import { hasChecker, registerChecker } from '../checkers';
import { getCustomPrompt, registerCustomPrompt } from '../customPrompts';
import type { GeneratorDef } from '../types';

if (!hasChecker(BALANCE_CHECK_ID)) registerChecker(BALANCE_CHECK_ID, balanceChecker);
if (!getCustomPrompt(BALANCE_PROMPT_TYPE)) {
  registerCustomPrompt(BALANCE_PROMPT_TYPE, {
    text: (_p, _item, locale, band) => t(locale, 'balance.prompt', {}, band),
    validate: (p, item) => {
      const d = readBalanceData(p.data);
      if (!d) return ['balance data is malformed'];
      const s = solveEquation(d.eq);
      return s && key(s) === key(item.answer.value) ? [] : ['the answer does not solve the equation'];
    },
  });
}

export const equationGen: GeneratorDef<{ skill?: BalanceSkill }> = {
  id: 'equation',
  version: 1,
  capabilities: ['build'],
  generate(level, rng, cfg) {
    const m = makeEquation(rng, cfg.skill ?? 'al.eq.onestep', level);
    const data = balanceData(m.eq, m.balloons);
    const lim = Math.max(10, Math.ceil(Math.abs(m.solution) / 5) * 5);
    return {
      level: m.achievedLevel,
      prompt: { kind: 'custom', type: BALANCE_PROMPT_TYPE, data },
      answer: { value: rat(m.solution), check: { id: BALANCE_CHECK_ID, params: data } },
      // Context only (the scale is the answer's home); graded by the checker.
      line: { min: -lim, max: lim, start: 0, major: 5, minor: 1, labelEvery: 5, steps: [1], answerMode: 'land' },
      solution: balanceSolutionSteps(m.eq, m.balloons),
      misconceptions: balanceMisconceptions(m.eq),
      features: m.features,
    };
  },
};
