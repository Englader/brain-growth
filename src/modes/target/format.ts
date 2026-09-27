/**
 * Locale rendering for Target expressions: numbers through the locale's
 * formatter, operators through its glyphs (MK · and :), brackets only where
 * precedence needs them (displayTokens). Plain text for labels and tests; the
 * components in Num.tsx draw non-integers as stacked fractions.
 */
import { isInteger, type Rational } from '../../core/rational';
import { displayTokens, type TargetOp, type TExpr } from '../../core/target/expr';
import type { LocaleId } from '../../core/types';
import { getLocale } from '../../i18n/locales';
import { formatNumber, formatRational } from '../../i18n/numbers';

export const opGlyph = (op: TargetOp | '=', locale: LocaleId): string => getLocale(locale).ops[op];

/** Message key naming an operator (button labels). */
export const OP_NAME: Record<TargetOp, 'target.op.add' | 'target.op.sub' | 'target.op.mul' | 'target.op.div'> = {
  '+': 'target.op.add',
  '-': 'target.op.sub',
  '*': 'target.op.mul',
  '/': 'target.op.div',
};

/** "24", "−3", "3/4" in the locale's digits and minus sign. */
export function valueText(v: Rational, locale: LocaleId): string {
  const conv = getLocale(locale).numbers;
  return isInteger(v) ? formatNumber(v.n, conv) : formatRational(v, conv, 'fraction');
}

/** "3 · 4 − 2", "12 : (4 − 1)", "6 − (−3)" for mk; "3 × 4 − 2" for en. */
export function exprText(e: TExpr, locale: LocaleId): string {
  return displayTokens(e)
    .map((t) => (t.t === 'num' ? valueText(t.v, locale) : t.t === 'op' ? ` ${opGlyph(t.op, locale)} ` : t.s))
    .join('');
}
