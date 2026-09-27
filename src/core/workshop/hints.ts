/**
 * The Workshop hint ladder (Bands B/C, flag `hints`): three tiers per task,
 * derived from the target alone, as locale-agnostic message keys and params
 * (rendered by i18n). A construction checked after tier t earns credit
 * 1 − 0.25·t (engine/observe.hintCredit), exactly as in the Hop ladder; a
 * "show me" is a wrong attempt (y = 0).
 *
 *   fraction bar   1 what the numbers mean (or: same amount, different cut)
 *                  2 how to split (or scale) the bar
 *                  3 how many parts to shade
 *   rectangle      1 what the measure means (no numbers)
 *                  2 half the perimeter (perimeter, both) or a length to try (area)
 *                  3 a length to try (perimeter, both) or the whole rectangle (area)
 *
 * Tier 1 never carries a number; later tiers narrow the search but still
 * leave the building (and the check) to the child.
 */
import { exampleRect, type RectConstraints } from './rect';
import type { FracBarTarget } from './fracbar';
import { WORKSHOP_SOL_KEYS } from './keys';

export interface WorkshopHint {
  tier: 1 | 2 | 3;
  key: string;
  params: Record<string, number>;
}

/** Tier-1 strategy keys (`workshop.hint.*`), with no numbers in their text. */
export const WORKSHOP_HINT_KEYS = {
  frac: 'workshop.hint.frac',
  fracScale: 'workshop.hint.fracScale',
  perimeter: 'workshop.hint.perimeter',
  area: 'workshop.hint.area',
  both: 'workshop.hint.both',
  halfPerimeter: 'workshop.hint.halfPerimeter', // {half}
  tryLength: 'workshop.hint.tryLength', // {w}
} as const;

export function fracBarHints(t: FracBarTarget): WorkshopHint[] {
  const parts = t.parts ?? t.d;
  const shade = (t.n * parts) / t.d;
  if (t.parts === undefined) {
    return [
      { tier: 1, key: WORKSHOP_HINT_KEYS.frac, params: {} },
      { tier: 2, key: WORKSHOP_SOL_KEYS.fracSplit, params: { parts } },
      { tier: 3, key: WORKSHOP_SOL_KEYS.fracShade, params: { shade, parts } },
    ];
  }
  const up = parts > t.d;
  return [
    { tier: 1, key: WORKSHOP_HINT_KEYS.fracScale, params: {} },
    up
      ? { tier: 2, key: WORKSHOP_SOL_KEYS.fracScaleUp, params: { k: parts / t.d, d: t.d, parts } }
      : { tier: 2, key: WORKSHOP_SOL_KEYS.fracScaleDown, params: { k: t.d / parts, d: t.d, parts } },
    { tier: 3, key: WORKSHOP_SOL_KEYS.fracShade, params: { shade, parts } },
  ];
}

export function rectHints(c: RectConstraints): WorkshopHint[] {
  const r = exampleRect(c);
  if (!r) return [];
  if (c.perimeter !== undefined) {
    return [
      { tier: 1, key: c.area !== undefined ? WORKSHOP_HINT_KEYS.both : WORKSHOP_HINT_KEYS.perimeter, params: {} },
      { tier: 2, key: WORKSHOP_HINT_KEYS.halfPerimeter, params: { half: c.perimeter / 2 } },
      { tier: 3, key: WORKSHOP_HINT_KEYS.tryLength, params: { w: r.w } },
    ];
  }
  return [
    { tier: 1, key: WORKSHOP_HINT_KEYS.area, params: {} },
    { tier: 2, key: WORKSHOP_HINT_KEYS.tryLength, params: { w: r.w } },
    { tier: 3, key: WORKSHOP_SOL_KEYS.rectArea, params: { w: r.w, h: r.h, area: r.w * r.h } },
  ];
}
