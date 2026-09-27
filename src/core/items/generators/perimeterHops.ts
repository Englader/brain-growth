/**
 * `perimeterHops` (numberLine, numeric): "walk the sides", the Hop binding
 * for `geo.perimeter`. `geo.area.rect` waits for `geo.perimeter`, so
 * perimeter must stay servable by Hop, or a child without the Workshop would
 * meet a wall (tests/walls.test.ts). The perimeter of a w×h rectangle is four
 * hops w, h, w, h; typing the area (w·h) or two sides (w + h) is diagnosed.
 *
 * Hop serves it, so it is eager (BUILTIN), in its own small module; the
 * Workshop's own generators load on demand (./workshop.ts). This module
 * registers the walk prompt once.
 */
import { tk } from '../../../i18n/i18n';
import { rat, toNumber } from '../../rational';
import type { Rng } from '../../rng';
import { WORKSHOP_SOL_KEYS } from '../../workshop/keys';
import { perimeterHops, RECT_MAX_SIDE } from '../../workshop/rect';
import { getCustomPrompt, registerCustomPrompt } from '../customPrompts';
import type { CustomPrompt, GeneratedItem, GeneratorDef, LineSpec } from '../types';
import { pickByLevel, uniqMisconceptions } from '../util';

export const PERIMETER_HOPS_GEN = 'perimeterHops';
/** Custom prompt of the Hop "walk the sides" items; data `{ w, h }`. */
export const WALK_PROMPT_TYPE = 'workshop.walk';

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
export function contextLine(v: number): LineSpec {
  const max = Math.max(20, Math.ceil((v + 5) / 10) * 10);
  return max <= 20
    ? { min: 0, max, start: 0, major: 5, minor: 1, labelEvery: 5, steps: [1], answerMode: 'land' }
    : { min: 0, max, start: 0, major: 10, minor: max <= 30 ? 1 : 5, labelEvery: 10, steps: [10, 1], answerMode: 'land' };
}

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

if (!getCustomPrompt(WALK_PROMPT_TYPE)) {
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
}
