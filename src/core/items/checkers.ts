/**
 * Checker registry: grading for items whose answer is not a single value
 * (an expression built from dealt cards, a shaded fraction bar, a rectangle
 * with a given area). An item opts in with `answer.check = { id, params }`;
 * gradeResponse then delegates to the checker registered under `id`.
 *
 * Register from the module that defines the checker, and import that module
 * from the generator that emits `check`, so anything that can produce the
 * item can also grade it:
 *
 *   registerChecker('target.expr', (item, response, params) => …);
 *
 * Checkers are pure: they re-derive correctness from the response itself
 * (e.g. re-parse `repr`), never trust a value the UI computed.
 */
import type { NumberConventions } from '../../i18n/numbers';
import type { Response } from './grade';
import type { Item } from './types';

export interface CheckResult {
  correct: boolean;
  /** Canonical, locale-free string of what the child built (logged as `answer`). */
  given: string;
  /** Unreadable or incomplete: ask again, do not count an attempt. */
  invalid?: boolean;
  /** Misconception code, when the wrong construction matches a known bug. */
  misconception?: string | null;
  /** Signed distance to the target, when meaningful. */
  delta?: number | null;
}

export type Checker = (item: Item, response: Response, params: Record<string, number>, conv: NumberConventions) => CheckResult;

const registry = new Map<string, Checker>();

export function registerChecker(id: string, check: Checker): void {
  if (registry.has(id)) throw new Error(`checker ${id} registered twice`);
  registry.set(id, check);
}

export function getChecker(id: string): Checker {
  const c = registry.get(id);
  if (!c) throw new Error(`unknown checker ${id}`);
  return c;
}

export function hasChecker(id: string): boolean {
  return registry.has(id);
}
