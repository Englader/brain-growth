/**
 * Workshop rectangle builder (9a): width and height steppers on a square grid
 * (dragging a corner is an enhancement only). The task gives an area, a
 * perimeter, or both ("area 24 and perimeter 20"); every integer rectangle
 * that fits the grid and meets the constraints is correct, in either
 * orientation (4×6 and 6×4 are both accepted).
 */
import type { Rng } from '../rng';
import type { SolutionStep } from '../items/types';
import { pickByLevel } from '../items/util';
import { WORKSHOP_SOL_KEYS } from './keys';

export type RectSkill = 'geo.perimeter' | 'geo.area.rect';
export type RectTask = 'perimeter' | 'area' | 'both';

export interface RectConstraints {
  area?: number;
  perimeter?: number;
  /** Grid size: both sides are 1…maxSide. */
  maxSide: number;
}

export interface Rect {
  w: number;
  h: number;
}

/** Largest grid the UI draws (12 cells ≈ 26 px each on a 360 px screen). */
export const RECT_MAX_SIDE = 12;
/** Grid sizes the generator picks from: the smallest that fits the sampled rectangle. */
export const RECT_GRIDS = [6, 8, 10, 12] as const;

export const rectArea = (r: Rect): number => r.w * r.h;
export const rectPerimeter = (r: Rect): number => 2 * (r.w + r.h);

function meets(c: RectConstraints, r: Rect): boolean {
  return (c.area === undefined || rectArea(r) === c.area) && (c.perimeter === undefined || rectPerimeter(r) === c.perimeter);
}

/**
 * Every valid rectangle, as ordered (w, h) pairs, w ascending. Enumerates
 * divisor pairs of the area, or the splits of the half-perimeter, rather than
 * the whole grid.
 */
export function allRects(c: RectConstraints): Rect[] {
  const M = c.maxSide;
  const out: Rect[] = [];
  if (c.area !== undefined) {
    const A = c.area;
    if (!Number.isInteger(A) || A < 1) return [];
    for (let w = 1; w <= Math.min(M, A); w++) {
      if (A % w !== 0) continue;
      const r = { w, h: A / w };
      if (r.h <= M && meets(c, r)) out.push(r);
    }
    return out;
  }
  if (c.perimeter !== undefined) {
    const P = c.perimeter;
    if (!Number.isInteger(P) || P % 2 !== 0) return [];
    const s = P / 2;
    for (let w = Math.max(1, s - M); w <= Math.min(M, s - 1); w++) out.push({ w, h: s - w });
    return out;
  }
  for (let w = 1; w <= M; w++) for (let h = 1; h <= M; h++) out.push({ w, h });
  return out;
}

/** Distinct shapes (4×6 and 6×4 count once). */
export function shapeCount(c: RectConstraints): number {
  return allRects(c).filter((r) => r.w <= r.h).length;
}

// ── Checker ─────────────────────────────────────────────────────────────────

export type RectReason = 'parse' | 'tooBig' | 'area' | 'perimeter';
export type RectMisconception = 'workshop.areaPerimeterSwap';

export interface RectCheck {
  ok: boolean;
  /** Not a rectangle on this grid (the steppers should make this impossible): ask again. */
  invalid: boolean;
  reason?: RectReason;
  misconception: RectMisconception | null;
  area: number | null;
  perimeter: number | null;
}

/**
 * Checks a built rectangle. `workshop.areaPerimeterSwap`: the child built the
 * asked-for number as the other measure (area P for a perimeter task, or
 * perimeter A for an area task).
 */
export function checkRect(c: RectConstraints, r: Rect): RectCheck {
  if (!Number.isSafeInteger(r.w) || !Number.isSafeInteger(r.h) || r.w < 1 || r.h < 1) {
    return { ok: false, invalid: true, reason: 'parse', misconception: null, area: null, perimeter: null };
  }
  const area = rectArea(r);
  const perimeter = rectPerimeter(r);
  if (r.w > c.maxSide || r.h > c.maxSide) {
    return { ok: false, invalid: true, reason: 'tooBig', misconception: null, area, perimeter };
  }
  const areaOk = c.area === undefined || area === c.area;
  const perimOk = c.perimeter === undefined || perimeter === c.perimeter;
  if (areaOk && perimOk) return { ok: true, invalid: false, misconception: null, area, perimeter };
  const swapped = (c.perimeter !== undefined && area === c.perimeter) || (c.area !== undefined && perimeter === c.area);
  return {
    ok: false,
    invalid: false,
    reason: areaOk ? 'perimeter' : 'area',
    misconception: swapped ? 'workshop.areaPerimeterSwap' : null,
    area,
    perimeter,
  };
}

// ── Generator ───────────────────────────────────────────────────────────────

export interface MadeRect {
  task: RectTask;
  constraints: RectConstraints;
  achievedLevel: number;
  features: Record<string, number>;
}

interface RectCand {
  task: RectTask;
  constraints: RectConstraints;
}

const gridFor = (r: Rect): number => RECT_GRIDS.find((g) => g >= Math.max(r.w, r.h)) ?? RECT_MAX_SIDE;

function sampleRect(r: Rng, skill: RectSkill): RectCand {
  for (;;) {
    const rect = { w: r.int(1, RECT_MAX_SIDE), h: r.int(1, RECT_MAX_SIDE) };
    const maxSide = gridFor(rect);
    if (skill === 'geo.perimeter') {
      if (rect.w + rect.h < 3) continue;
      return { task: 'perimeter', constraints: { perimeter: rectPerimeter(rect), maxSide } };
    }
    const area = rectArea(rect);
    if (area < 2 || area > 72) continue;
    if (r.chance(0.4)) return { task: 'both', constraints: { area, perimeter: rectPerimeter(rect), maxSide } };
    return { task: 'area', constraints: { area, maxSide } };
  }
}

export function rectFeatures(t: RectTask, c: RectConstraints): Record<string, number> {
  return {
    task: ['perimeter', 'area', 'both'].indexOf(t),
    area: c.area ?? 0,
    perimeter: c.perimeter ?? 0,
    maxSide: c.maxSide,
    shapes: shapeCount(c),
  };
}

export function scoreRect(skill: RectSkill, f: Record<string, number>): number {
  const g = (k: string): number => f[k] ?? 0;
  if (skill === 'geo.perimeter') {
    // Longer walks around the edge; a single possible shape is harder to find.
    return 0.04 + 0.022 * (g('perimeter') - 6) + 0.08 * (g('shapes') === 1 ? 1 : 0);
  }
  // Area and perimeter together (one shape to search for) is the hard task; then size.
  return 0.04 + 0.32 * (g('task') === 2 ? 1 : 0) + 0.008 * g('area') + 0.012 * (g('maxSide') - 6);
}

export function makeRect(rng: Rng, skill: RectSkill, level: number): MadeRect {
  const { value, level: achievedLevel } = pickByLevel(
    rng,
    level,
    (r) => {
      const c = sampleRect(r, skill);
      return { c, features: rectFeatures(c.task, c.constraints) };
    },
    (x) => scoreRect(skill, x.features),
    32,
  );
  return { task: value.c.task, constraints: value.c.constraints, achievedLevel, features: value.features };
}

// ── Repr, item data and solution ────────────────────────────────────────────

/** Locale-free repr "4x6" (width x height). */
export const rectRepr = (r: Rect): string => `${r.w}x${r.h}`;

export function parseRectRepr(repr: string): Rect | null {
  const m = /^(\d{1,3})x(\d{1,3})$/.exec(typeof repr === 'string' ? repr.trim() : '');
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/** Item payload (numbers only; 0 = no such constraint). */
export type RectData = {
  area: number;
  perimeter: number;
  maxSide: number;
};

export function rectData(c: RectConstraints): RectData {
  return { area: c.area ?? 0, perimeter: c.perimeter ?? 0, maxSide: c.maxSide };
}

export function readRectData(data: unknown): RectConstraints | null {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;
  const num = (v: unknown): number | null => (v === undefined ? 0 : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
  const area = num(o.area);
  const perimeter = num(o.perimeter);
  const maxSide = num(o.maxSide);
  if (area === null || perimeter === null || maxSide === null || maxSide < 1 || maxSide > RECT_MAX_SIDE) return null;
  const c: RectConstraints = { maxSide };
  if (area > 0) c.area = area;
  if (perimeter > 0) c.perimeter = perimeter;
  return c;
}

/** Checker for the `built` response: constraints from item data, rectangle from `repr` ("4x6"). */
export function checkRectRepr(data: unknown, repr: string): RectCheck & { given: string } {
  const c = readRectData(data);
  const r = parseRectRepr(repr);
  if (!c || !r) {
    return { ok: false, invalid: true, reason: 'parse', misconception: null, area: null, perimeter: null, given: String(repr).slice(0, 20) };
  }
  return { ...checkRect(c, r), given: rectRepr(r) };
}

/**
 * "Walk the sides": the perimeter of a w×h rectangle as four hops on a number
 * line from `start` (w, h, w, h), so a Hop-only child can practise perimeter.
 */
export function perimeterHops(w: number, h: number, start = 0): Array<{ k: 'hop'; from: number; to: number }> {
  const hops: Array<{ k: 'hop'; from: number; to: number }> = [];
  let at = start;
  for (const side of [w, h, w, h]) {
    hops.push({ k: 'hop', from: at, to: at + side });
    at += side;
  }
  return hops;
}

/** The most square valid rectangle, the one the worked solution shows. */
export function exampleRect(c: RectConstraints): Rect | null {
  let best: Rect | null = null;
  for (const r of allRects(c)) {
    if (r.w > r.h) continue;
    if (!best || r.h - r.w < best.h - best.w) best = r;
  }
  return best;
}

/** Worked steps (`sol.workshop.rect*`, see ./keys.ts); perimeter tasks also walk the sides as hops. */
export function rectSolutionSteps(c: RectConstraints): SolutionStep[] {
  const r = exampleRect(c);
  if (!r) return [];
  const steps: SolutionStep[] = [];
  if (c.perimeter !== undefined) {
    steps.push(...perimeterHops(r.w, r.h));
    steps.push({ k: 'say', key: WORKSHOP_SOL_KEYS.rectPerimeter, params: { w: r.w, h: r.h, perimeter: rectPerimeter(r) } });
  }
  if (c.area !== undefined) {
    steps.push({ k: 'say', key: WORKSHOP_SOL_KEYS.rectArea, params: { w: r.w, h: r.h, area: rectArea(r) } });
  }
  if (shapeCount(c) > 1) steps.push({ k: 'say', key: WORKSHOP_SOL_KEYS.rectOthers, params: { count: shapeCount(c) - 1 } });
  return steps;
}
