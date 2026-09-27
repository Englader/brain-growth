/**
 * Numbers and expressions on the Target board. Whole numbers go through the
 * locale formatter; other values use the shared stacked fraction (Frac, the
 * number line's), never decimals, because the solver works in exact
 * fractions. Operators use the locale's glyphs.
 */
import type { JSX } from 'preact';
import { isInteger, type Rational } from '../../core/rational';
import { displayTokens, type TExpr } from '../../core/target/expr';
import type { LocaleId } from '../../core/types';
import { getLocale } from '../../i18n/locales';
import { formatNumber } from '../../i18n/numbers';
import { Frac } from '../../ui/components/Prompts';
import { opGlyph, valueText } from './format';

export function Num({ v, locale }: { v: Rational; locale: LocaleId }): JSX.Element {
  const conv = getLocale(locale).numbers;
  if (isInteger(v)) return <span class="tnum">{formatNumber(v.n, conv)}</span>;
  return (
    <span class="tfrac" role="img" aria-label={valueText(v, locale)}>
      {v.n < 0 && <span class="tfrac-sign">{conv.minus}</span>}
      <Frac n={formatNumber(Math.abs(v.n), conv)} d={formatNumber(v.d, conv)} />
    </span>
  );
}

/** An expression with minimal brackets, optionally "= result". */
export function Expr({ e, locale, result }: { e: TExpr; locale: LocaleId; result?: Rational | undefined }): JSX.Element {
  return (
    <span class="texpr" dir="ltr">
      {displayTokens(e).map((tk) =>
        tk.t === 'num' ? (
          <Num v={tk.v} locale={locale} />
        ) : tk.t === 'op' ? (
          <span class="texpr-op">{opGlyph(tk.op, locale)}</span>
        ) : (
          <span class="texpr-paren">{tk.s}</span>
        ),
      )}
      {result && (
        <>
          <span class="texpr-op">{opGlyph('=', locale)}</span>
          <Num v={result} locale={locale} />
        </>
      )}
    </span>
  );
}
