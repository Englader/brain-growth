/**
 * Locale rendering for the Balance scale: equation sides, moves and amounts.
 * Numbers go through the locale formatter, operators through the locale's
 * glyphs (· and : in Macedonian), and the unknown's letter through the
 * bundle (`balance.var`).
 */
import type { BalanceMove, Equation, Pan } from '../../core/balance';
import { panTerms } from '../../core/balance';
import type { LocaleId } from '../../core/types';
import { tk } from '../../i18n/i18n';
import { getLocale } from '../../i18n/locales';
import { formatNumber } from '../../i18n/numbers';

const fmt = (n: number, locale: LocaleId): string => formatNumber(n, getLocale(locale).numbers);
const unknown = (locale: LocaleId): string => tk(locale, 'balance.var');

/** "2x", "x", "12" for a magnitude (no sign). */
export function amountText(n: number, term: 'x' | 'k', locale: LocaleId): string {
  if (term === 'k') return fmt(n, locale);
  return n === 1 ? unknown(locale) : `${fmt(n, locale)}${unknown(locale)}`;
}

/** One side, e.g. "−2x + 5", "x", "0". */
export function panText(p: Pan, locale: LocaleId): string {
  const ops = getLocale(locale).ops;
  return panTerms(p)
    .map((t, i) => {
      const body = amountText(Math.abs(t.coef), t.x ? 'x' : 'k', locale);
      if (i === 0) return t.coef < 0 ? `${ops['-']}${body}` : body;
      return ` ${t.coef < 0 ? ops['-'] : ops['+']} ${body}`;
    })
    .join('');
}

export function equationText(eq: Equation, locale: LocaleId): string {
  return `${panText(eq.l, locale)} ${getLocale(locale).ops['=']} ${panText(eq.r, locale)}`;
}

/** A move as the child composes it: "− 4", "+ 2x", ": 3", ": (−1)". */
export function moveText(m: BalanceMove, locale: LocaleId): string {
  const ops = getLocale(locale).ops;
  if (m.op === 'div') return `${ops['/']} ${m.n < 0 ? `(${fmt(m.n, locale)})` : fmt(m.n, locale)}`;
  const signed = m.op === 'add' ? m.n : -m.n;
  return `${signed < 0 ? ops['-'] : ops['+']} ${amountText(Math.abs(signed), m.term, locale)}`;
}
