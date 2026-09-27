/** Integer addition/subtraction on a number line that extends below zero (Band C entry). */
import { rat } from '../../rational';
import type { GeneratedItem, GeneratorDef, SolutionStep } from '../types';
import { bin, clamp01, num, pickByLevel, uniqMisconceptions } from '../util';

type Form = 'a+b' | 'a-b' | 'a+(-b)' | 'a-(-b)';
const FORMS: readonly Form[] = ['a+b', 'a-b', 'a+(-b)', 'a-(-b)'];

/** b > 0 in every form; the form says where the signs go. */
interface IntItem {
  form: Form;
  a: number;
  b: number;
}

const deltaOf = ({ form, b }: IntItem): number => (form === 'a+b' || form === 'a-(-b)' ? b : -b);

function score(v: IntItem): number {
  const res = v.a + deltaOf(v);
  const crosses = (v.a < 0 && res > 0) || (v.a > 0 && res < 0) ? 1 : 0;
  return (
    0.08 +
    (v.a < 0 ? 0.2 : 0) +
    0.22 * crosses +
    (v.form === 'a+(-b)' ? 0.18 : 0) +
    (v.form === 'a-(-b)' ? 0.38 : 0) +
    0.01 * Math.abs(res) +
    (res < 0 ? 0.08 : 0)
  );
}

function build(v: IntItem, level: number): GeneratedItem {
  const { form, a, b } = v;
  const delta = deltaOf(v);
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
    level,
    prompt: { kind: 'expr', expr: bin(op, a, rhs) },
    answer: { value: rat(r) },
    // −20…20 (sampled items always fit); fixed operands beyond it widen the line.
    line: { min: Math.min(-20, a, r), max: Math.max(20, a, r), start: a, major: 5, minor: 1, labelEvery: 5, steps: [1], answerMode: 'land' },
    solution: steps,
    misconceptions: uniqMisconceptions(mis, r),
    features: { a, b, r, form: FORMS.indexOf(form) },
  };
}

export const intAddSubGen: GeneratorDef<Record<string, never>> = {
  id: 'intAddSub',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng) {
    const { value, level: lv } = pickByLevel(
      rng,
      level,
      (r): IntItem => {
        const form = r.pick<Form>(['a+b', 'a-b', 'a+(-b)', 'a-(-b)']);
        const a = r.int(-10, 10);
        const b = r.int(1, 10);
        return { form, a, b };
      },
      score,
    );
    return build(value, lv);
  },
  /** `a + b`, `a − b`, `a + (−b)`, `a − (−b)` from a signed b: `{a: 5, op: '-', b: -3}` is 5 − (−3). */
  fromOperands({ a, op, b }) {
    if ((op !== '+' && op !== '-') || !Number.isInteger(a) || !Number.isInteger(b) || b === 0) return null;
    const form: Form = op === '+' ? (b > 0 ? 'a+b' : 'a+(-b)') : b > 0 ? 'a-b' : 'a-(-b)';
    const v: IntItem = { form, a, b: Math.abs(b) };
    return build(v, clamp01(score(v)));
  },
};
