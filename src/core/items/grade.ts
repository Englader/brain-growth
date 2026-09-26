/**
 * Grading. Pure, locale-aware, and biased toward the child: any plausible
 * reading of the input that equals the answer counts as correct, and input
 * that cannot be read is `invalid` (ask again), never "wrong".
 */
import type { NumberConventions } from '../../i18n/numbers';
import { parseNumberInput } from '../../i18n/numbers';
import { eq, key, rat, toNumber, type Rational } from '../rational';
import type { Item } from './types';

export type Response =
  /** Typed on the numpad. */
  | { kind: 'typed'; raw: string }
  /** Landed on a position (pad tap, hop buttons, ruler tap). */
  | { kind: 'landed'; value: number; hops?: number }
  /** Number of hops taken (count-mode items answered with hop buttons). */
  | { kind: 'hops'; count: number };

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
  const misFor = (v: Rational): string | null =>
    v.d === 1 ? item.misconceptions.find((m) => m.value === v.n)?.code ?? null : null;

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

  const value = response.kind === 'hops' ? rat(response.count) : rat(Math.round(response.value * 1000), 1000);
  let correct: boolean;
  if (item.line.answerMode === 'count' && response.kind === 'landed') {
    // Count items answered by landing: correct if the hops taken reach the flag exactly.
    correct = response.value === item.line.flag;
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
