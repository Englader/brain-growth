/**
 * Locale-aware number display and a hand-written, deliberately lenient parser.
 *
 * Correctness rule: a child must NEVER be marked wrong because of a separator.
 * The parser therefore returns every plausible interpretation of the input
 * (primary interpretation first, chosen by the active locale) and the grader
 * accepts the answer if ANY interpretation matches. Inputs that cannot be read
 * at all are reported as `invalid`/`incomplete`, never as a wrong answer.
 */
import { rat, type Rational, add, fromDecimalString, neg, div, toNumber } from '../core/rational';

export interface NumberConventions {
  /** BCP-47 tag handed to Intl. */
  bcp47: string;
  /** Decimal separator shown to the child (',' in mk, '.' in en). */
  decimal: string;
  /** Thousands separator for display ('\u00A0' no-break space in mk). */
  group: string;
  /** Group only when the integer part has >= 3 + this many digits (mk: 2 → "1234", "12 345"). */
  minimumGroupingDigits: number;
  /** Minus glyph for display. U+2212 renders at the same width as '+'. */
  minus: string;
}

export type ParsedNumber =
  | {
      ok: true;
      /** Interpretations, primary (locale-preferred) first. Usually length 1. */
      candidates: Rational[];
      ambiguous: boolean;
      percent: boolean;
      form: 'integer' | 'decimal' | 'fraction' | 'mixed';
    }
  | { ok: false; reason: 'empty' | 'invalid' | 'incomplete' };

const MINUS_CHARS = /[−‒–—﹣－]/g;
const SPACE_GROUP_CHARS = /[\s\u00A0\u202F\u2009\u2007'’_]/;

function invalid(): ParsedNumber {
  return { ok: false, reason: 'invalid' };
}

/** Validate "1 234 567"-style grouping: first group 1-3 digits, the rest exactly 3. */
function validGroups(groups: string[]): boolean {
  if (groups.length === 0) return false;
  if (groups.length === 1) return /^\d+$/.test(groups[0] ?? '');
  const [first, ...rest] = groups;
  return /^\d{1,3}$/.test(first ?? '') && rest.every((g) => /^\d{3}$/.test(g));
}

/**
 * Parse an unsigned decimal body such as "1.234,5", "1 234", "0,75", ",5".
 * `groupChars` are separators already known to be grouping (spaces etc.).
 */
function parseUnsignedDecimal(body: string, conv: NumberConventions): Rational[] | null {
  if (!/^[\d.,\s\u00A0\u202F\u2009\u2007'’_]+$/.test(body)) return null;
  if (!/\d/.test(body)) return null;

  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;

  // Split helper: integer part may contain grouping chars (sep and whitespace).
  const build = (intRaw: string, fracRaw: string | null, groupSep: string | null): Rational | null => {
    let groups: string[];
    if (intRaw === '') groups = ['0'];
    else {
      const splitter = groupSep
        ? new RegExp(`[${groupSep === '.' ? '\\.' : groupSep}\\s\\u00A0\\u202F\\u2009\\u2007'’_]`)
        : SPACE_GROUP_CHARS;
      groups = intRaw.split(splitter);
      if (!validGroups(groups)) return null;
    }
    const intDigits = groups.join('');
    if (fracRaw !== null && !/^\d*$/.test(fracRaw)) return null;
    return fromDecimalString(fracRaw ? `${intDigits}.${fracRaw}` : intDigits);
  };

  // Case 1: no dot/comma at all → integer with optional whitespace grouping.
  if (dots + commas === 0) {
    const r = build(body, null, null);
    return r ? [r] : null;
  }

  // Case 2: both present → the LAST one is the decimal mark, the other groups.
  if (dots > 0 && commas > 0) {
    const lastDot = body.lastIndexOf('.');
    const lastComma = body.lastIndexOf(',');
    const decChar = lastDot > lastComma ? '.' : ',';
    const grpChar = decChar === '.' ? ',' : '.';
    const decCount = decChar === '.' ? dots : commas;
    if (decCount !== 1) return null;
    const idx = body.lastIndexOf(decChar);
    const intRaw = body.slice(0, idx);
    const fracRaw = body.slice(idx + 1);
    if (intRaw.includes(decChar)) return null;
    const r = build(intRaw, fracRaw, grpChar);
    return r ? [r] : null;
  }

  // Case 3: one kind of separator.
  const sepChar = dots > 0 ? '.' : ',';
  const count = dots > 0 ? dots : commas;

  if (count > 1) {
    // Repeated → must be grouping ("1.234.567").
    const r = build(body, null, sepChar);
    return r ? [r] : null;
  }

  const idx = body.indexOf(sepChar);
  const intRaw = body.slice(0, idx);
  const fracRaw = body.slice(idx + 1);
  const intDigitsOnly = intRaw.replace(/[\s\u00A0\u202F\u2009\u2007'’_]/g, '');
  const couldBeGroup =
    /^\d{3}$/.test(fracRaw) &&
    /^\d{1,3}$/.test(intRaw.split(SPACE_GROUP_CHARS).pop() ?? '') &&
    intDigitsOnly.length > 0 &&
    !/^0/.test(intDigitsOnly);

  const asDecimal = build(intRaw, fracRaw, null);
  if (!couldBeGroup) return asDecimal ? [asDecimal] : null;

  // Genuinely ambiguous, e.g. "1,234": en reads 1234, mk reads 1.234.
  const asGroup = build(body, null, sepChar);
  const options = [asDecimal, asGroup].filter((x): x is Rational => x !== null);
  if (options.length === 0) return null;
  // Primary interpretation follows the locale's own decimal mark.
  const decimalFirst = sepChar === conv.decimal;
  if (options.length === 2 && !decimalFirst) options.reverse();
  return options;
}

export function parseNumberInput(raw: string, conv: NumberConventions): ParsedNumber {
  let s = raw.normalize('NFKC').replace(MINUS_CHARS, '-').trim();
  if (s === '') return { ok: false, reason: 'empty' };

  let sign = 1;
  if (s[0] === '-' || s[0] === '+') {
    sign = s[0] === '-' ? -1 : 1;
    s = s.slice(1).trim();
    if (s === '') return { ok: false, reason: 'incomplete' };
  }

  let percent = false;
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1).trim();
    if (s === '') return { ok: false, reason: 'incomplete' };
  }

  // Fractions and mixed numbers: "3/4", "1 1/2", "1⁄2" (NFKC maps U+2044 to '/').
  if (s.includes('/') || s.includes('⁄')) {
    const m = /^(?:(\d+)\s+)?(\d+)\s*[/⁄]\s*(\d*)$/.exec(s);
    if (!m) return invalid();
    if ((m[3] ?? '') === '') return { ok: false, reason: 'incomplete' };
    const den = Number(m[3]);
    if (den === 0) return invalid();
    let value = rat(Number(m[2]), den);
    if (m[1] !== undefined) value = add(rat(Number(m[1])), value);
    if (sign < 0) value = neg(value);
    if (percent) value = div(value, rat(100));
    return { ok: true, candidates: [value], ambiguous: false, percent, form: m[1] ? 'mixed' : 'fraction' };
  }

  // A trailing separator ("5,") is what a child produces by tapping the comma
  // key and then submitting. Read it as the integer.
  s = s.replace(/[.,]$/, '');
  if (s === '') return { ok: false, reason: 'incomplete' };

  const values = parseUnsignedDecimal(s, conv);
  if (!values) return invalid();
  const candidates = values.map((v) => {
    let x = sign < 0 ? neg(v) : v;
    if (percent) x = div(x, rat(100));
    return x;
  });
  return {
    ok: true,
    candidates,
    ambiguous: candidates.length > 1,
    percent,
    form: candidates.every((c) => c.d === 1) && !/[.,]/.test(s) ? 'integer' : 'decimal',
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const intlCache = new Map<string, Intl.NumberFormat>();

function intlFor(conv: NumberConventions, maxFrac: number, minFrac: number): Intl.NumberFormat {
  const k = `${conv.bcp47}|${maxFrac}|${minFrac}`;
  let f = intlCache.get(k);
  if (!f) {
    f = new Intl.NumberFormat(conv.bcp47, {
      maximumFractionDigits: maxFrac,
      minimumFractionDigits: minFrac,
      useGrouping: true,
    });
    intlCache.set(k, f);
  }
  return f;
}

export interface FormatOptions {
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
  /** Suppress grouping (e.g. years, or when a place-value lesson shows raw digits). */
  grouping?: boolean;
}

/**
 * Format with Intl for digits and rounding, then force the separators to the
 * locale's configured glyphs. Browsers with thin ICU data for `mk` would
 * otherwise silently fall back to "3.14" — a correctness bug, not cosmetics.
 */
export function formatNumber(value: number, conv: NumberConventions, opts: FormatOptions = {}): string {
  const maxFrac = opts.maximumFractionDigits ?? 6;
  const minFrac = Math.min(opts.minimumFractionDigits ?? 0, maxFrac);
  const parts = intlFor(conv, maxFrac, minFrac).formatToParts(value);
  const intDigits = parts.filter((p) => p.type === 'integer').reduce((n, p) => n + p.value.length, 0);
  const useGroups = opts.grouping !== false && intDigits >= 3 + conv.minimumGroupingDigits;
  let out = '';
  for (const p of parts) {
    switch (p.type) {
      case 'group':
        out += useGroups ? conv.group : '';
        break;
      case 'decimal':
        out += conv.decimal;
        break;
      case 'minusSign':
        out += conv.minus;
        break;
      case 'integer':
      case 'fraction':
        // Guard against non-Latin digit systems slipping in via locale data.
        out += p.value.replace(/[^\d]/g, (ch) => String(ch.charCodeAt(0) & 0xf));
        break;
      default:
        out += p.value;
    }
  }
  return out;
}

/** Format a Rational: integers and terminating decimals as numbers, else "a/b". */
export function formatRational(r: Rational, conv: NumberConventions, style: 'auto' | 'fraction' = 'auto'): string {
  if (r.d === 1) return formatNumber(r.n, conv);
  if (style === 'auto') {
    // d = 2^a * 5^b  ⇒ exactly max(a, b) decimal digits are needed.
    let d = r.d;
    let twos = 0;
    let fives = 0;
    while (d % 2 === 0) { d /= 2; twos++; }
    while (d % 5 === 0) { d /= 5; fives++; }
    if (d === 1) {
      return formatNumber(toNumber(r), conv, { maximumFractionDigits: Math.max(twos, fives) });
    }
  }
  const sign = r.n < 0 ? conv.minus : '';
  return `${sign}${formatNumber(Math.abs(r.n), conv)}/${formatNumber(r.d, conv)}`;
}
