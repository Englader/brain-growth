/**
 * Coordinate plane (9c): lattice points in −6…6, the point checker with its
 * misconceptions, snapping a tap to the lattice, and the locale-free repr.
 */

export interface Point {
  x: number;
  y: number;
}

/** The plane runs from −PLANE_MAX to PLANE_MAX on both axes. */
export const PLANE_MAX = 6;

export function samePoint(p: Point, q: Point): boolean {
  return p.x === q.x && p.y === q.y;
}

export function onPlane(p: Point, max = PLANE_MAX): boolean {
  return Number.isInteger(p.x) && Number.isInteger(p.y) && Math.abs(p.x) <= max && Math.abs(p.y) <= max;
}

/** Quadrant 1–4 (I: x>0,y>0; II: x<0,y>0; III: x<0,y<0; IV: x>0,y<0), 0 on an axis. */
export function quadrant(p: Point): 0 | 1 | 2 | 3 | 4 {
  if (p.x === 0 || p.y === 0) return 0;
  if (p.x > 0) return p.y > 0 ? 1 : 4;
  return p.y > 0 ? 2 : 3;
}

/**
 * Snaps a tap (in plane units, e.g. 2.4, −0.7) to the nearest lattice point on
 * the plane. The UI converts pixels to plane units; the child then confirms.
 */
export function snapToLattice(px: number, py: number, max = PLANE_MAX): Point {
  const s = (v: number): number => Math.max(-max, Math.min(max, Math.round(v))) + 0;
  return { x: s(px), y: s(py) };
}

export type CoordMisconception = 'coord.swapped' | 'coord.sign' | 'coord.offByOne';

export const COORD_MISCONCEPTIONS: readonly CoordMisconception[] = ['coord.swapped', 'coord.sign', 'coord.offByOne'];

export interface PointCheck {
  ok: boolean;
  /**
   * Checked in this order, first match wins:
   * - `coord.swapped`: (y, x) given for (x, y) (x ≠ y);
   * - `coord.sign`: one coordinate's sign flipped, or both (the mirror point);
   * - `coord.offByOne`: each coordinate within 1 (e.g. counting the origin as 1).
   */
  misconception: CoordMisconception | null;
  dx: number;
  dy: number;
}

export function checkPoint(target: Point, given: Point): PointCheck {
  const dx = given.x - target.x;
  const dy = given.y - target.y;
  if (dx === 0 && dy === 0) return { ok: true, misconception: null, dx, dy };
  let misconception: CoordMisconception | null = null;
  const flippedX = target.x !== 0 && given.x === -target.x;
  const flippedY = target.y !== 0 && given.y === -target.y;
  if (target.x !== target.y && given.x === target.y && given.y === target.x) misconception = 'coord.swapped';
  else if ((flippedX || dx === 0) && (flippedY || dy === 0)) misconception = 'coord.sign';
  else if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) misconception = 'coord.offByOne';
  return { ok: false, misconception, dx, dy };
}

// ── Repr (the `built` response) ─────────────────────────────────────────────

/** Locale-free repr of a point, e.g. "3,-2". Display text goes through ./notation.ts. */
export function pointRepr(p: Point): string {
  return `${p.x + 0},${p.y + 0}`;
}

export function parsePointRepr(repr: string): Point | null {
  const m = /^(-?\d{1,3}),(-?\d{1,3})$/.exec(typeof repr === 'string' ? repr.trim() : '');
  if (!m) return null;
  return { x: Number(m[1]) + 0, y: Number(m[2]) + 0 };
}

/** Item payload: the target point, all numbers (fits `prompt.data` and `answer.check.params`). */
export type CoordData = {
  x: number;
  y: number;
  /** 0 = plot (tap the point), 1 = read (type x, then y). */
  read: 0 | 1;
};

export function readCoordData(data: unknown): CoordData | null {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;
  const p = { x: o.x, y: o.y };
  if (typeof p.x !== 'number' || typeof p.y !== 'number' || !onPlane(p as Point)) return null;
  const read = o.read === undefined ? 0 : o.read;
  if (read !== 0 && read !== 1) return null;
  return { x: p.x + 0, y: p.y + 0, read };
}

export interface CoordCheckResult extends PointCheck {
  /** Malformed data or repr, or a point off the plane: ask again. */
  invalid: boolean;
  /** Canonical repr of the given point (the log's `given`). */
  given: string;
}

/**
 * Checker for the `built` response: re-reads the target from item data and
 * the point from `repr` ("x,y"); a value the UI computed is never used.
 */
export function checkCoord(data: unknown, repr: string): CoordCheckResult {
  const target = readCoordData(data);
  const given = parsePointRepr(repr);
  if (!target || !given || !onPlane(given)) {
    return { ok: false, invalid: true, misconception: null, dx: 0, dy: 0, given: String(repr).slice(0, 40) };
  }
  return { ...checkPoint(target, given), invalid: false, given: pointRepr(given) };
}
