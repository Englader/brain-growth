/**
 * Grading. Pure, locale-aware, and biased toward the child: any plausible
 * reading of the input that equals the answer counts as correct, and input
 * that cannot be read is `invalid` (ask again), never "wrong".
 */
import type { NumberConventions } from '../../i18n/numbers';
import { parseNumberInput } from '../../i18n/numbers';
import { eq, key, rat, toNumber, type Rational } from '../rational';
import { getChecker } from './checkers';
import type { Item } from './types';

export type Response =
  /** Typed on the numpad. */
  | { kind: 'typed'; raw: string }
  /** Landed on a position (pad tap, hop buttons, ruler tap). */
  | { kind: 'landed'; value: number; hops?: number }
  /** Number of hops taken (count-mode items answered with hop buttons). */
  | { kind: 'hops'; count: number }
  /**
   * Something the child constructed (an expression from dealt cards, a shaded
   * bar, a rectangle). `repr` is a canonical, locale-free description a checker
   * can re-parse; `value` is what it evaluates to, if it has one. Without
   * `answer.check` it is graded by `value` alone.
   */
  | { kind: 'built'; value: Rational | null; repr: string; data?: Record<string, number> };

export interface GradeResult {
  correct: boolean;
  /** Input could not be read as a number: prompt again, do not count an attempt. */
  invalid: boolean;
  /** Canonical string of what the child answered (for the log). */
  given: string;
  /** Misconception code if the wrong answer matches a known bug. */
  misconception: string | null;
  /** Correct only under the non-primary separator reading (analytics). */
  altReading: boolean;
  /** Signed distance to the answer, when meaningful (number-line feedback). */
  delta: number | null;
}

export function gradeResponse(item: Item, response: Response, conv: NumberConventions): GradeResult {
  const expected = item.answer.value;
  const tol = item.answer.tolerance ?? 0;
  if (item.answer.check) {
    const c = getChecker(item.answer.check.id)(item, response, item.answer.check.params ?? {}, conv);
    return {
      correct: !c.invalid && c.correct,
      invalid: !!c.invalid,
      given: c.given,
      misconception: c.correct || c.invalid ? null : c.misconception ?? null,
      altReading: false,
      delta: c.delta ?? null,
    };
  }
  // Predicted wrong answers are numbers (3, 0.45, 2/3 as a double): match within
  // float noise, so a fraction or decimal answer maps to its code too.
  const misFor = (v: Rational): string | null => {
    const x = toNumber(v);
    return item.misconceptions.find((m) => Math.abs(m.value - x) < 1e-9)?.code ?? null;
  };

  if (response.kind === 'typed') {
    const parsed = parseNumberInput(response.raw, conv);
    if (!parsed.ok) {
      return { correct: false, invalid: true, given: response.raw, misconception: null, altReading: false, delta: null };
    }
    const hitIndex = parsed.candidates.findIndex((c) =>
      tol > 0 ? Math.abs(toNumber(c) - toNumber(expected)) <= tol : eq(c, expected),
    );
    const primary = parsed.candidates[0]!;
    if (hitIndex >= 0) {
      return {
        correct: true,
        invalid: false,
        given: key(parsed.candidates[hitIndex]!),
        misconception: null,
        altReading: hitIndex > 0,
        delta: toNumber(parsed.candidates[hitIndex]!) - toNumber(expected),
      };
    }
    return {
      correct: false,
      invalid: false,
      given: key(primary),
      misconception: misFor(primary),
      altReading: false,
      delta: toNumber(primary) - toNumber(expected),
    };
  }

  if (response.kind === 'built') {
    const v = response.value;
    if (!v) return { correct: false, invalid: true, given: response.repr, misconception: null, altReading: false, delta: null };
    const ok = tol > 0 ? Math.abs(toNumber(v) - toNumber(expected)) <= tol : eq(v, expected);
    return { correct: ok, invalid: false, given: key(v), misconception: ok ? null : misFor(v), altReading: false, delta: toNumber(v) - toNumber(expected) };
  }

  // A landing on a rational line is exactly k/den (1/3 stays 1/3); elsewhere thousandths.
  const den = item.line.den;
  const value =
    response.kind === 'hops' ? rat(response.count) : den ? rat(Math.round(response.value * den), den) : rat(Math.round(response.value * 1000), 1000);
  let correct: boolean;
  if (item.line.answerMode === 'count' && response.kind === 'landed') {
    // Count items answered by landing: correct if the hops taken reach the flag exactly.
    const flag = item.line.flag ?? NaN;
    correct = den ? Math.round(response.value * den) === Math.round(flag * den) : response.value === flag;
    const hopsTaken = response.hops ?? Math.round((response.value - item.line.start) / (item.line.hopSize ?? 1));
    return {
      correct,
      invalid: false,
      given: String(hopsTaken),
      misconception: correct ? null : misFor(rat(hopsTaken)),
      altReading: false,
      delta: response.value - (item.line.flag ?? 0),
    };
  }
  correct = tol > 0 ? Math.abs(toNumber(value) - toNumber(expected)) <= tol : eq(value, expected);
  return {
    correct,
    invalid: false,
    given: key(value),
    misconception: correct ? null : misFor(value),
    altReading: false,
    delta: toNumber(value) - toNumber(expected),
  };
}
