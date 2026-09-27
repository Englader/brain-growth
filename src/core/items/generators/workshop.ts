/**
 * Workshop items (DESIGN §1.4, plan step 9a): the constructed object is
 * checked, not a typed number.
 *
 *  - fracBar     split a bar with ± steppers and shade parts (f.unit, f.equiv).
 *                Graded by `workshop.frac`: every equivalent construction is
 *                accepted unless the task fixes the number of parts.
 *  - rectBuild   size a rectangle on a grid (geo.perimeter, geo.area.rect).
 *                Graded by `workshop.rect`: every valid rectangle is accepted,
 *                in either orientation.
 *  - perimeterHops  "walk the sides" on the number line (geo.perimeter in Hop),
 *                so a child without the Workshop is never walled off: the
 *                perimeter of a w×h rectangle is four hops w, h, w, h.
 *
 * fracBar and rectBuild provide only 'build', so only the Workshop serves
 * them (and it serves only them: Balance and Coord build too, see
 * WORKSHOP_GENERATORS). The checkers and custom prompts are registered here,
 * once, so anything that can produce these items can also grade and show them.
 *
 * A "show me" is submitted as `{ kind: 'built', value: null, repr: '', data:
 * { reveal: 1 } }`: a wrong attempt (y = 0), never an invalid one.
 */
import { tk } from '../../../i18n/i18n';
import { getLocale } from '../../../i18n/locales';
import { formatFraction } from '../../../i18n/numbers';
import { rat, toNumber } from '../../rational';
import type { Rng } from '../../rng';
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
  perimeterHops,
  readFracBarData,
  readRectData,
  RECT_CHECK_ID,
  RECT_MAX_SIDE,
  RECT_PROMPT_TYPE,
  rectChecker,
  rectData,
  rectSolutionSteps,
  WORKSHOP_SOL_KEYS,
  type FracBarTarget,
  type FracTask,
  type MadeFracBar,
  type MadeRect,
  type RectConstraints,
  type RectTask,
} from '../../workshop';
import type { Checker } from '../checkers';
import { registerChecker } from '../checkers';
import { registerCustomPrompt } from '../customPrompts';
import type { CustomPrompt, GeneratedItem, GeneratorDef, LineSpec } from '../types';
import { pickByLevel, uniqMisconceptions } from '../util';

export const FRAC_BAR_GEN = 'fracBar';
export const RECT_GEN = 'rectBuild';
export const PERIMETER_HOPS_GEN = 'perimeterHops';
/** Custom prompt of the Hop "walk the sides" items; data `{ w, h }`. */
export const WALK_PROMPT_TYPE = 'workshop.walk';
/** Generators the Workshop mode serves (its skill filter). */
export const WORKSHOP_GENERATORS: ReadonlySet<string> = new Set([FRAC_BAR_GEN, RECT_GEN]);

/** Misconception codes of the "walk the sides" items (typed answers). */
export const WALK_MISCONCEPTIONS = {
  /** Gave the area w·h for the perimeter. */
  swap: 'workshop.areaPerimeterSwap',
  /** Added two sides only (w + h). */
  half: 'workshop.halfPerimeter',
} as const;

/**
 * A line from 0 past v on round numbers, with a little room beyond it (the
 * walk-the-sides answer is not at the very end). Context only for Workshop
 * items, which are not answered on a line.
 */
function contextLine(v: number): LineSpec {
  const max = Math.max(20, Math.ceil((v + 5) / 10) * 10);
  return max <= 20
    ? { min: 0, max, start: 0, major: 5, minor: 1, labelEvery: 5, steps: [1], answerMode: 'land' }
    : { min: 0, max, start: 0, major: 10, minor: max <= 30 ? 1 : 5, labelEvery: 10, steps: [10, 1], answerMode: 'land' };
}

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

// ── Walk the sides (Hop) ────────────────────────────────────────────────────

interface Walk {
  w: number;
  h: number;
}

/** Longer walks first; a square (all sides equal) is easier, a side of ten or more harder. */
export function scoreWalk({ w, h }: Walk): number {
  const p = 2 * (w + h);
  return 0.03 + 0.019 * (p - 4) - 0.08 * (w === h ? 1 : 0) + 0.08 * (Math.max(w, h) >= 10 ? 1 : 0);
}

export function walkItem(level: number, rng: Rng): GeneratedItem {
  const { value, level: achieved } = pickByLevel(
    rng,
    level,
    (r): Walk => ({ w: r.int(1, RECT_MAX_SIDE), h: r.int(1, RECT_MAX_SIDE) }),
    scoreWalk,
  );
  const { w, h } = value;
  const p = 2 * (w + h);
  return {
    level: achieved,
    prompt: { kind: 'custom', type: WALK_PROMPT_TYPE, data: { w, h } },
    answer: { value: rat(p) },
    line: contextLine(p),
    solution: [
      ...perimeterHops(w, h),
      { k: 'say', key: WORKSHOP_SOL_KEYS.walkSides, params: { w, h } },
      { k: 'say', key: WORKSHOP_SOL_KEYS.rectPerimeter, params: { w, h, perimeter: p } },
    ],
    misconceptions: uniqMisconceptions(
      [
        { value: w * h, code: WALK_MISCONCEPTIONS.swap },
        { value: w + h, code: WALK_MISCONCEPTIONS.half },
      ],
      p,
    ),
    features: { w, h, perimeter: p, square: w === h ? 1 : 0 },
  };
}

export const perimeterHopsGen: GeneratorDef<Record<string, never>> = {
  id: PERIMETER_HOPS_GEN,
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng) {
    return walkItem(level, rng);
  },
};

// ── Grading (registered once, here) ─────────────────────────────────────────

/** "Show me": the child asked for the construction. A wrong attempt, not unreadable input. */
function withReveal(check: Checker): Checker {
  return (item, response, params, conv) =>
    response.kind === 'built' && response.data?.reveal ? { correct: false, given: 'reveal', misconception: null, delta: null } : check(item, response, params, conv);
}

registerChecker(FRAC_BAR_CHECK_ID, withReveal(fracBarChecker));
registerChecker(RECT_CHECK_ID, withReveal(rectChecker));

// ── Prompts: the instruction as one sentence (B/C text, labels), and validation ──

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

registerCustomPrompt(WALK_PROMPT_TYPE, {
  text(p: CustomPrompt, _item, locale, band) {
    const { w, h } = p.data as { w?: unknown; h?: unknown };
    if (typeof w !== 'number' || typeof h !== 'number') return tk(locale, 'prompt.custom', {}, band);
    return tk(locale, 'workshop.walk', { w, h }, band);
  },
  spoken(p) {
    const { w, h } = p.data as { w?: unknown; h?: unknown };
    return typeof w === 'number' && typeof h === 'number' ? { key: 'voice.workshop.walk', params: { w, h } } : null;
  },
  validate(p, item) {
    const { w, h } = p.data as { w?: unknown; h?: unknown };
    if (!Number.isInteger(w) || !Number.isInteger(h) || (w as number) < 1 || (h as number) < 1) return ['walk data is malformed'];
    return toNumber(item.answer.value) === 2 * ((w as number) + (h as number)) ? [] : ['answer is not the perimeter'];
  },
});
