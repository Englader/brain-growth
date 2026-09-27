/**
 * Workshop items (DESIGN §1.4, plan step 9a): the constructed object is
 * checked, not a typed number.
 *
 *  - fracBar    split a bar with ± steppers and shade parts (f.unit, f.equiv).
 *               Graded by `workshop.frac`: every equivalent construction is
 *               accepted unless the task fixes the number of parts.
 *  - rectBuild  size a rectangle on a grid (geo.perimeter, geo.area.rect).
 *               Graded by `workshop.rect`: every valid rectangle is accepted,
 *               in either orientation.
 *
 * Both provide only 'build', so only the Workshop serves them (and it serves
 * only them: Balance and Coord build too, see WORKSHOP_GENERATORS). They load
 * on demand with the mode (ON_DEMAND in ./index.ts); this module registers the
 * two checkers and custom prompts once, when it loads. Hop's "walk the sides"
 * for geo.perimeter is eager, in ./perimeterHops.ts.
 *
 * A "show me" is submitted as `{ kind: 'built', value: null, repr: '', data:
 * { reveal: 1 } }`: a wrong attempt (y = 0), never an invalid one.
 */
import { tk } from '../../../i18n/i18n';
import { getLocale } from '../../../i18n/locales';
import { formatFraction } from '../../../i18n/numbers';
import { rat, toNumber } from '../../rational';
import {
  allRects,
  checkFracBar,
  exampleRect,
  FRAC_BAR_CHECK_ID,
  FRAC_BAR_PROMPT_TYPE,
  fracBarChecker,
  fracBarData,
  fracBarSolutionSteps,
  fracBarValue,
  makeFracBar,
  makeRect,
  readFracBarData,
  readRectData,
  RECT_CHECK_ID,
  RECT_PROMPT_TYPE,
  rectChecker,
  rectData,
  rectSolutionSteps,
  type FracBarTarget,
  type FracTask,
  type MadeFracBar,
  type MadeRect,
  type RectConstraints,
  type RectTask,
} from '../../workshop';
import { hasChecker, registerChecker, type Checker } from '../checkers';
import { getCustomPrompt, registerCustomPrompt } from '../customPrompts';
import type { CustomPrompt, GeneratedItem, GeneratorDef } from '../types';
import { contextLine } from './perimeterHops';

export const FRAC_BAR_GEN = 'fracBar';
export const RECT_GEN = 'rectBuild';
/** Generators the Workshop mode serves (its skill filter uses the same ids). */
export const WORKSHOP_GENERATORS: ReadonlySet<string> = new Set([FRAC_BAR_GEN, RECT_GEN]);

// ── Fraction bar ────────────────────────────────────────────────────────────

export interface FracBarConfig {
  /** f.unit: "shade 3/4" (any parts); f.equiv: "show 2/3 with 6 parts" (scale up or down). */
  task: 'unit' | 'equiv';
}

export function fracBarItem(m: MadeFracBar): GeneratedItem {
  const data = fracBarData(m.target);
  return {
    level: m.achievedLevel,
    prompt: { kind: 'custom', type: FRAC_BAR_PROMPT_TYPE, data: { ...data } },
    answer: { value: fracBarValue(m.target), check: { id: FRAC_BAR_CHECK_ID, params: { ...data } } },
    line: { min: 0, max: 1, start: 0, major: 1, minor: 1, labelEvery: 1, steps: [1], answerMode: 'land' },
    solution: fracBarSolutionSteps(m.task, m.target),
    misconceptions: [],
    features: m.features,
  };
}

export const fracBarGen: GeneratorDef<FracBarConfig> = {
  id: FRAC_BAR_GEN,
  version: 1,
  capabilities: ['build'],
  generate(level, rng, cfg) {
    return fracBarItem(makeFracBar(rng, cfg.task === 'equiv' ? 'f.equiv' : 'f.unit', level));
  },
};

/** The bar task of an item (null when the item is not one): target as shown, and which kind of task. */
export function fracBarOf(item: Pick<GeneratedItem, 'prompt'>): { target: FracBarTarget; task: FracTask } | null {
  const p = item.prompt;
  if (p.kind !== 'custom' || p.type !== FRAC_BAR_PROMPT_TYPE) return null;
  const target = readFracBarData(p.data);
  if (!target) return null;
  const task: FracTask = target.parts === undefined ? 'make' : target.parts > target.d ? 'scaleUp' : 'scaleDown';
  return { target, task };
}

// ── Rectangle ───────────────────────────────────────────────────────────────

export interface RectConfig {
  /** geo.perimeter: "perimeter 20"; geo.area.rect: "area 24", later "area 24 and perimeter 20". */
  measure: 'perimeter' | 'area';
}

const taskOf = (c: RectConstraints): RectTask => (c.area === undefined ? 'perimeter' : c.perimeter === undefined ? 'area' : 'both');

/**
 * The item's answer value is the measure asked for (the area when both are):
 * what a correct rectangle "represents" in the log. Only a perimeter task
 * keeps the walk-the-sides hops in its solution (they end at that value).
 */
export function rectItem(m: MadeRect): GeneratedItem {
  const c = m.constraints;
  const task = taskOf(c);
  const value = task === 'perimeter' ? c.perimeter! : c.area!;
  const steps = rectSolutionSteps(c);
  return {
    level: m.achievedLevel,
    prompt: { kind: 'custom', type: RECT_PROMPT_TYPE, data: { ...rectData(c) } },
    answer: { value: rat(value), check: { id: RECT_CHECK_ID, params: { ...rectData(c) } } },
    line: contextLine(value),
    solution: task === 'perimeter' ? steps : steps.filter((s) => s.k === 'say'),
    misconceptions: [],
    features: m.features,
  };
}

export const rectGen: GeneratorDef<RectConfig> = {
  id: RECT_GEN,
  version: 1,
  capabilities: ['build'],
  generate(level, rng, cfg) {
    return rectItem(makeRect(rng, cfg.measure === 'area' ? 'geo.area.rect' : 'geo.perimeter', level));
  },
};

/** The rectangle task of an item (null when the item is not one). */
export function rectOf(item: Pick<GeneratedItem, 'prompt'>): { constraints: RectConstraints; task: RectTask } | null {
  const p = item.prompt;
  if (p.kind !== 'custom' || p.type !== RECT_PROMPT_TYPE) return null;
  const c = readRectData(p.data);
  if (!c || (c.area === undefined && c.perimeter === undefined)) return null;
  return { constraints: c, task: taskOf(c) };
}

// ── Grading (registered once, when this module loads) ─────────────────────────────────────────

/** "Show me": the child asked for the construction. A wrong attempt, not unreadable input. */
function withReveal(check: Checker): Checker {
  return (item, response, params, conv) =>
    response.kind === 'built' && response.data?.reveal ? { correct: false, given: 'reveal', misconception: null, delta: null } : check(item, response, params, conv);
}

if (!hasChecker(FRAC_BAR_CHECK_ID)) registerChecker(FRAC_BAR_CHECK_ID, withReveal(fracBarChecker));
if (!hasChecker(RECT_CHECK_ID)) registerChecker(RECT_CHECK_ID, withReveal(rectChecker));

// ── Prompts: the instruction as one sentence (B/C text, labels), and validation ──

if (!getCustomPrompt(FRAC_BAR_PROMPT_TYPE)) {
  registerCustomPrompt(FRAC_BAR_PROMPT_TYPE, {
    text(p: CustomPrompt, _item, locale, band) {
      const t = readFracBarData(p.data);
      if (!t) return tk(locale, 'prompt.custom', {}, band);
      const frac = formatFraction(t.n, t.d, getLocale(locale).numbers);
      return t.parts === undefined ? tk(locale, 'workshop.frac.text', { frac }, band) : tk(locale, 'workshop.frac.textParts', { frac, parts: t.parts }, band);
    },
    validate(p, item) {
      const t = readFracBarData(p.data);
      if (!t) return ['bar data is malformed'];
      const problems: string[] = [];
      const parts = t.parts ?? t.d;
      if (item.answer.check?.id !== FRAC_BAR_CHECK_ID) problems.push('answer is not graded by workshop.frac');
      if (toNumber(item.answer.value) !== t.n / t.d) problems.push('answer is not the target fraction');
      if ((t.n * parts) % t.d !== 0) problems.push('the target is not a whole number of parts');
      else if (!checkFracBar(t, { parts, shaded: (t.n * parts) / t.d }).ok) problems.push('the intended bar fails the checker');
      if (t.n < 1 || t.n >= t.d) problems.push('the target is not a proper fraction');
      return problems;
    },
  });
}

if (!getCustomPrompt(RECT_PROMPT_TYPE)) {
  registerCustomPrompt(RECT_PROMPT_TYPE, {
    text(p: CustomPrompt, _item, locale, band) {
      const c = readRectData(p.data);
      if (!c) return tk(locale, 'prompt.custom', {}, band);
      if (c.area !== undefined && c.perimeter !== undefined) return tk(locale, 'workshop.rect.both', { area: c.area, perimeter: c.perimeter }, band);
      if (c.area !== undefined) return tk(locale, 'workshop.rect.area', { area: c.area }, band);
      return tk(locale, 'workshop.rect.perimeter', { perimeter: c.perimeter ?? 0 }, band);
    },
    validate(p, item) {
      const r = rectOf({ prompt: p });
      if (!r) return ['rectangle data is malformed'];
      const c = r.constraints;
      const problems: string[] = [];
      if (item.answer.check?.id !== RECT_CHECK_ID) problems.push('answer is not graded by workshop.rect');
      if (!allRects(c).length) problems.push('no rectangle fits');
      const ex = exampleRect(c);
      if (!ex || (c.area !== undefined && ex.w * ex.h !== c.area) || (c.perimeter !== undefined && 2 * (ex.w + ex.h) !== c.perimeter)) problems.push('the example rectangle does not fit');
      const want = r.task === 'perimeter' ? c.perimeter : c.area;
      if (toNumber(item.answer.value) !== want) problems.push('answer is not the measure asked for');
      return problems;
    },
  });
}
