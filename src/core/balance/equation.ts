/**
 * Balance (9b) equation model: `a·x + b = c·x + d` with integer coefficients,
 * shown as a pan scale. Each pan holds x-boxes and unit weights; in Band C a
 * negative amount is shown as balloons pulling the pan up (−3 = three unit
 * balloons, −2x = two x-balloons).
 *
 * Everything here is locale-free data. Display text (the minus glyph, the
 * multiplication dot, "x") is the presentation layer's job.
 */
import { rat, type Rational } from '../rational';

/** One pan (one side of the equation): `x`·x + `k`. */
export interface Pan {
  readonly x: number;
  readonly k: number;
}

/** `l.x·x + l.k = r.x·x + r.k`. */
export interface Equation {
  readonly l: Pan;
  readonly r: Pan;
}

/** Builds `a·x + b = c·x + d`. */
export function eqn(a: number, b: number, c: number, d: number): Equation {
  return { l: { x: a + 0, k: b + 0 }, r: { x: c + 0, k: d + 0 } };
}

/** The four numbers `[a, b, c, d]` of `a·x + b = c·x + d`. */
export function coefs(eq: Equation): [number, number, number, number] {
  return [eq.l.x, eq.l.k, eq.r.x, eq.r.k];
}

export function sameEquation(p: Equation, q: Equation): boolean {
  return p.l.x === q.l.x && p.l.k === q.l.k && p.r.x === q.r.x && p.r.k === q.r.k;
}

/** Every coefficient and constant is a safe integer. */
export function isIntegerEquation(eq: Equation): boolean {
  return coefs(eq).every((v) => Number.isSafeInteger(v));
}

/**
 * The unique solution, or `null` when there is none or infinitely many
 * (`a = c`). Balanced moves never change it, which is what the checker relies on.
 */
export function solveEquation(eq: Equation): Rational | null {
  const a = eq.l.x - eq.r.x;
  if (a === 0) return null;
  return rat(eq.r.k - eq.l.k, a);
}

/** Both pans weigh the same when x = `x`. */
export function holdsAt(eq: Equation, x: number): boolean {
  return eq.l.x * x + eq.l.k === eq.r.x * x + eq.r.k;
}

/**
 * x stands alone on one pan (coefficient exactly 1, no weights next to it) and
 * the other pan holds weights only: `x = 3` or `3 = x`.
 */
export function isolatedValue(eq: Equation): number | null {
  if (eq.l.x === 1 && eq.l.k === 0 && eq.r.x === 0) return eq.r.k;
  if (eq.r.x === 1 && eq.r.k === 0 && eq.l.x === 0) return eq.l.k;
  return null;
}

/** Any negative coefficient or constant: the scale needs balloons to show it. */
export function hasNegatives(eq: Equation): boolean {
  return coefs(eq).some((v) => v < 0);
}

/**
 * Whether the scale for this equation must show balloons: a negative number in
 * the equation, or a negative solution (the last pan would hold balloons).
 * Band C scales always allow balloons; Band B scales only when this is true.
 */
export function needsBalloons(eq: Equation): boolean {
  const s = solveEquation(eq);
  return hasNegatives(eq) || (s !== null && s.n < 0);
}

// ── Scale view ──────────────────────────────────────────────────────────────

/** What one pan shows. At most one of `xBoxes`/`xBalloons`, and of `units`/`balloons`, is non-zero. */
export interface PanView {
  xBoxes: number;
  xBalloons: number;
  units: number;
  balloons: number;
}

export interface ScaleView {
  left: PanView;
  right: PanView;
}

function panView(p: Pan): PanView {
  return {
    xBoxes: Math.max(0, p.x),
    xBalloons: Math.max(0, -p.x),
    units: Math.max(0, p.k),
    balloons: Math.max(0, -p.k),
  };
}

/**
 * The scale for an equation. Constants run up to about 60, so the UI should
 * group unit weights (e.g. a "10" weight plus ones) rather than draw 60 cubes.
 */
export function scaleView(eq: Equation): ScaleView {
  return { left: panView(eq.l), right: panView(eq.r) };
}

// ── Terms for display ───────────────────────────────────────────────────────

/**
 * One signed term of a pan, in display order (x-term first, then the
 * constant). The first term carries its own sign ("−2x"); later terms are
 * joined with + or − by their sign ("−2x − 3"). `coef` ±1 on an x-term is
 * shown as "x" / "−x". An empty pan is a single `{x: false, coef: 0}` ("0").
 */
export interface Term {
  x: boolean;
  coef: number;
}

export function panTerms(p: Pan): Term[] {
  const out: Term[] = [];
  if (p.x !== 0) out.push({ x: true, coef: p.x });
  if (p.k !== 0) out.push({ x: false, coef: p.k });
  if (out.length === 0) out.push({ x: false, coef: 0 });
  return out;
}

function panAscii(p: Pan): string {
  let s = '';
  for (const [i, t] of panTerms(p).entries()) {
    const mag = Math.abs(t.coef);
    const body = t.x ? (mag === 1 ? 'x' : `${mag}x`) : String(mag);
    if (i === 0) s += (t.coef < 0 ? '-' : '') + body;
    else s += (t.coef < 0 ? '-' : '+') + body;
  }
  return s;
}

/** Canonical ASCII form for logs and tests, e.g. "2x+4=10", "-x-3=2x+6", "5=x". */
export function equationKey(eq: Equation): string {
  return `${panAscii(eq.l)}=${panAscii(eq.r)}`;
}
