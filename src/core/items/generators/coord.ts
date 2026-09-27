/**
 * Coordinate-plane generator (step 9c), capability 'build': plot a lattice
 * point on the −6…6 plane (tap, snap, confirm) or read one (type x, then y).
 * Graded by the `coord.point` checker from the item's own data; `geo.coord`
 * is a leaf of the skill graph, so a child without this mode meets no wall.
 *
 * `answer.value` is 0: a point has no single value. The target lives in
 * `answer.check.params` ({x, y, read}) and the log's `answer` is the given
 * point as "x,y".
 *
 * This module registers the `coord.point` checker and custom prompt once.
 */
import {
  COORD_CHECK_ID,
  COORD_PROMPT_TYPE,
  coordChecker,
  coordData,
  coordPromptKey,
  coordSolutionSteps,
  formatPoint,
  makeCoordItem,
  PLANE_MAX,
  readCoordData,
} from '../../coord';
import { t } from '../../../i18n/i18n';
import { getLocale } from '../../../i18n/locales';
import { rat } from '../../rational';
import { hasChecker, registerChecker } from '../checkers';
import { getCustomPrompt, registerCustomPrompt } from '../customPrompts';
import type { GeneratorDef } from '../types';

if (!hasChecker(COORD_CHECK_ID)) registerChecker(COORD_CHECK_ID, coordChecker);
if (!getCustomPrompt(COORD_PROMPT_TYPE)) {
  registerCustomPrompt(COORD_PROMPT_TYPE, {
    text: (p, _item, locale, band) => {
      const d = readCoordData(p.data);
      if (!d) return t(locale, 'prompt.custom', {}, band);
      return d.read ? t(locale, coordPromptKey('read'), {}, band) : t(locale, coordPromptKey('plot'), { point: formatPoint(d, getLocale(locale)) }, band);
    },
    validate: (p, item) => {
      const d = readCoordData(p.data);
      if (!d) return ['coord data is malformed'];
      const c = item.answer.check;
      if (!c || c.params?.x !== d.x || c.params?.y !== d.y) return ['checker params do not match the prompt'];
      return Math.abs(d.x) === Math.abs(d.y) ? ['|x| = |y| hides a swap'] : [];
    },
  });
}

export const coordGen: GeneratorDef<Record<string, never>> = {
  id: 'coord',
  version: 1,
  capabilities: ['build'],
  generate(level, rng) {
    const it = makeCoordItem(rng, level);
    const data = coordData(it);
    return {
      level: it.achievedLevel,
      prompt: { kind: 'custom', type: COORD_PROMPT_TYPE, data },
      answer: { value: rat(0), check: { id: COORD_CHECK_ID, params: data } },
      line: { min: -PLANE_MAX, max: PLANE_MAX, start: 0, major: 1, minor: 1, labelEvery: 1, steps: [1], answerMode: 'land' },
      solution: coordSolutionSteps(it.target),
      misconceptions: [],
      features: it.features,
    };
  },
};
