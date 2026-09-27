/**
 * Message keys the Workshop mode needs, with their params. The strings live in
 * the locale bundles: the `workshop` block, `sol.workshop` and `mis.workshop`
 * (plus `mis.frac` for the fraction-bar codes, which carry the `frac.`
 * prefix so they sit with the other fraction misconceptions).
 */

/** Misconception codes; strings at `mis.<code>.{name,tip}`. */
export const WORKSHOP_MIS_KEYS = {
  'frac.partsVsShaded': 'mis.frac.partsVsShaded', // shaded the unshaded share, or read shaded:unshaded as the fraction
  'frac.unequalParts': 'mis.frac.unequalParts', // counted pieces of unequal size (free-cut UI only)
  'frac.numeratorKept': 'mis.frac.numeratorKept', // more parts but the same number shaded (2 of 6 for 2/3)
  'workshop.areaPerimeterSwap': 'mis.workshop.areaPerimeterSwap', // built the asked number as the other measure
} as const;

/** Worked-solution steps emitted by the core, with params. */
export const WORKSHOP_SOL_KEYS = {
  fracScaleUp: 'sol.workshop.fracScaleUp', // {k, d, parts}: "Split each of the {d} parts into {k}: that makes {parts}."
  fracScaleDown: 'sol.workshop.fracScaleDown', // {k, d, parts}: "Join every {k} of the {d} parts: that makes {parts}."
  fracSplit: 'sol.workshop.fracSplit', // {parts}: "Split the bar into {parts} equal parts."
  fracShade: 'sol.workshop.fracShade', // {shade, parts}: "Shade {shade} of the {parts} parts."
  rectPerimeter: 'sol.workshop.rectPerimeter', // {w, h, perimeter}: "{w} + {h} + {w} + {h} = {perimeter}"
  rectArea: 'sol.workshop.rectArea', // {w, h, area}: "{w} × {h} = {area} squares" (mk: ·)
  rectOthers: 'sol.workshop.rectOthers', // {count}: "{count, plural, one {# other shape} other {# other shapes}} also work."
  walkSides: 'sol.workshop.walkSides', // {w, h}: "Walk the sides: {w}, then {h}, then {w} and {h} again." (Hop "walk the sides" items)
} as const;

/** `workshop.*` UI strings. */
export const WORKSHOP_UI_KEYS = [
  'workshop.title',
  'workshop.flag',
  'workshop.frac.make', // {n, d}: "Shade {n}/{d} of the bar." (render the fraction stacked; n/d go through the formatter)
  'workshop.frac.withParts', // {n, d, parts}: "Show {n}/{d} using {parts} parts."
  'workshop.frac.parts', // stepper label: "Parts"
  'workshop.frac.part', // aria label of one part: {i, parts, shaded}
  'workshop.rect.perimeter', // {perimeter}: "Build a rectangle with perimeter {perimeter}."
  'workshop.rect.area', // {area}: "Build a rectangle with area {area}."
  'workshop.rect.both', // {area, perimeter}: "Build a rectangle with area {area} and perimeter {perimeter}."
  'workshop.rect.width', // stepper label
  'workshop.rect.height', // stepper label
  'workshop.rect.readout', // {area, perimeter}: live readout under the grid
  'workshop.check', // "Check" button
  'workshop.unequal', // "The parts are not equal." (feedback for `unequal`)
  'workshop.wrongParts', // {parts}: "Use {parts} parts." (feedback for `wrongParts`)
] as const;
