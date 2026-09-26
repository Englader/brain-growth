/** Integer addition/subtraction on a number line that extends below zero (Band C entry). */
import { rat } from '../../rational';
import type { GeneratorDef, SolutionStep } from '../types';
import { bin, num, pickByLevel, uniqMisconceptions } from '../util';

type Form = 'a+b' | 'a-b' | 'a+(-b)' | 'a-(-b)';

export const intAddSubGen: GeneratorDef<Record<string, never>> = {
  id: 'intAddSub',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng) {
    const { value, level: lv } = pickByLevel(
      rng,
      level,
      (r) => {
        const form = r.pick<Form>(['a+b', 'a-b', 'a+(-b)', 'a-(-b)']);
        const a = r.int(-10, 10);
        const b = r.int(1, 10);
        return { form, a, b };
      },
      ({ form, a, b }) => {
        const delta = form === 'a+b' || form === 'a-(-b)' ? b : -b;
        const res = a + delta;
        const crosses = (a < 0 && res > 0) || (a > 0 && res < 0) ? 1 : 0;
        return (
          0.08 +
          (a < 0 ? 0.2 : 0) +
          0.22 * crosses +
          (form === 'a+(-b)' ? 0.18 : 0) +
          (form === 'a-(-b)' ? 0.38 : 0) +
          0.01 * Math.abs(res) +
          (res < 0 ? 0.08 : 0)
        );
      },
    );
    const { form, a, b } = value;
    const delta = form === 'a+b' || form === 'a-(-b)' ? b : -b;
    const r = a + delta;
    const op = form.startsWith('a+') ? '+' : '-';
    const rhs = form.includes('(-b)') ? num(-b) : num(b);
    const steps: SolutionStep[] = [];
    if (form === 'a-(-b)') steps.push({ k: 'say', key: 'sol.subNeg', params: { a, b } });
    if (form === 'a+(-b)') steps.push({ k: 'say', key: 'sol.addNeg', params: { a, b } });
    steps.push(
      { k: 'hop', from: a, to: r },
      { k: 'say', key: 'sol.intMove', params: { a, n: b, dir: delta > 0 ? 'right' : 'left', r } },
    );
    const mis: Array<{ value: number; code: string }> = [{ value: -r, code: 'int.sign_error' }];
    if (form === 'a-(-b)') mis.push({ value: a - b, code: 'int.sub_neg_as_sub' });
    if (a < 0 && form === 'a+b') mis.push({ value: -(Math.abs(a) + b), code: 'int.added_magnitudes' });
    return {
      level: lv,
      prompt: { kind: 'expr', expr: bin(op, a, rhs) },
      answer: { value: rat(r) },
      line: { min: -20, max: 20, start: a, major: 5, minor: 1, labelEvery: 5, steps: [1], answerMode: 'land' },
      solution: steps,
      misconceptions: uniqMisconceptions(mis, r),
      features: { a, b, r, form: ['a+b', 'a-b', 'a+(-b)', 'a-(-b)'].indexOf(form) },
    };
  },
};
