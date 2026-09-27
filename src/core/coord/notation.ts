/**
 * Point notation per locale: "(3, −2)" or "(3; −2)", with an optional name,
 * "A(3, −2)".
 *
 * Decision for Macedonian: "(3, −2)", a comma, the same as English, for
 * integer coordinates. The official МОН e-textbook "Математика за 6
 * одделение" (e-ucebnici.mon.gov.mk, the chapter "Правоаголен координатен
 * систем") writes "А(–1, 2); В(3, 4); С(–3, –2)" and "М(–2, 3); N(–4, –2)":
 * a comma between x and y, and a semicolon between points in a list.
 * Macedonian uses the decimal comma, so a comma separator would be ambiguous
 * as soon as a coordinate is not an integer ("(1,5, 2)"); for that case the
 * mk config switches to a semicolon, "(1,5; 2)", which is also what
 * mk.wikipedia's Декартов координатен систем does for decimal points
 * ("(−1,5; −2,5)"). Items in −6…6 are all integers today, so children see the
 * textbook form; the fallback only matters for later function items.
 *
 * The separator ends in a no-break space so a point never wraps inside its
 * brackets (U+00A0 is in both self-hosted font subsets; mk already uses it
 * as its digit-group separator).
 *
 * Configurable: pass `{ point }` in the locale config (the integrator adds
 * `point?: PointNotation` to `LocaleConfig` in src/i18n/locales.ts); without
 * it the defaults below apply, keyed by locale id.
 */
import type { NumberConventions } from '../../i18n/numbers';
import { formatNumber } from '../../i18n/numbers';
import type { LocaleId } from '../types';
import type { Point } from './point';

export interface PointNotation {
  open: string;
  close: string;
  /** Between x and y when both are integers. */
  sep: string;
  /** Between x and y when either has a fractional part (a comma would clash with a decimal comma). */
  sepDecimal: string;
  /** Between points in a list: "A(1, 2); B(3, 4)". */
  listSep: string;
}

const NBSP = ' ';

export const DEFAULT_POINT_NOTATION: PointNotation = {
  open: '(',
  close: ')',
  sep: `,${NBSP}`,
  sepDecimal: `,${NBSP}`,
  listSep: '; ',
};

export const POINT_NOTATIONS: Record<LocaleId, PointNotation> = {
  en: DEFAULT_POINT_NOTATION,
  mk: { open: '(', close: ')', sep: `,${NBSP}`, sepDecimal: `;${NBSP}`, listSep: '; ' },
};

/** The slice of a `LocaleConfig` point formatting needs; `getLocale(id)` satisfies it. */
export interface PointLocale {
  id: LocaleId;
  numbers: NumberConventions;
  point?: PointNotation;
}

export function pointNotationFor(cfg: PointLocale): PointNotation {
  return cfg.point ?? POINT_NOTATIONS[cfg.id] ?? DEFAULT_POINT_NOTATION;
}

/**
 * Formats a point with an explicit notation and number formatter (the pure
 * core of `formatPoint`; tests and non-UI callers use it directly).
 */
export function formatPointWith(p: Point, notation: PointNotation, fmt: (n: number) => string, name = ''): string {
  const sep = Number.isInteger(p.x) && Number.isInteger(p.y) ? notation.sep : notation.sepDecimal;
  return `${name}${notation.open}${fmt(p.x)}${sep}${fmt(p.y)}${notation.close}`;
}

/** "A(3, −2)" in the locale's notation, numbers through the locale's formatter (minus is U+2212). */
export function formatPoint(p: Point, cfg: PointLocale, name = ''): string {
  return formatPointWith(p, pointNotationFor(cfg), (n) => formatNumber(n, cfg.numbers), name);
}

/** Several named points, "A(1, 2); B(3, 4)". */
export function formatPointList(points: ReadonlyArray<{ name: string; p: Point }>, cfg: PointLocale): string {
  return points.map(({ name, p }) => formatPoint(p, cfg, name)).join(pointNotationFor(cfg).listSep);
}
