/**
 * Locale-aware rendering of structured items: expressions (with the locale's
 * operator glyphs), word problems (from the per-locale bank), worked-solution
 * steps and spoken prompts. Nothing here is hard-coded display text.
 */
import { getCustomPrompt } from '../core/items/customPrompts';
import type { Expr, Item, LineSpec, Prompt, SolutionStep } from '../core/items/types';
import type { BandId, LocaleId } from '../core/types';
import { formatMessage } from './format';
import { formatEnv, t, tk } from './i18n';
import { getLocale, type OperatorGlyphs } from './locales';
import { formatFraction, formatNumber, formatPercent, formatRational } from './numbers';

export type ExprToken =
  | { t: 'num'; s: string }
  | { t: 'op'; s: string }
  | { t: 'paren'; s: string }
  /** A fraction, drawn stacked; `n: null` is a blank numerator. */
  | { t: 'frac'; n: string | null; d: string }
  | { t: 'blank' };

export function exprTokens(e: Expr, locale: LocaleId, isRightOperand = false): ExprToken[] {
  const cfg = getLocale(locale);
  switch (e.k) {
    case 'blank':
      return [{ t: 'blank' }];
    case 'num': {
      const s = formatNumber(e.v, cfg.numbers);
      return e.v < 0 && isRightOperand ? [{ t: 'paren', s: '(' }, { t: 'num', s }, { t: 'paren', s: ')' }] : [{ t: 'num', s }];
    }
    case 'frac':
      return [{ t: 'frac', n: e.n === null ? null : formatNumber(e.n, cfg.numbers), d: formatNumber(e.d, cfg.numbers) }];
    case 'op':
      return [
        ...exprTokens(e.a, locale, false),
        { t: 'op', s: cfg.ops[e.op] },
        ...exprTokens(e.b, locale, true),
      ];
  }
}

export function tokensText(tokens: ExprToken[]): string {
  return tokens
    .map((tk) => (tk.t === 'blank' ? '?' : tk.t === 'frac' ? `${tk.n ?? '?'}/${tk.d}` : tk.t === 'op' ? ` ${tk.s} ` : tk.s))
    .join('')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}

export function wordProblemText(prompt: Extract<Prompt, { kind: 'word' }>, locale: LocaleId): string {
  const bank = getLocale(locale).wordProblems;
  const tpl = bank.templates[prompt.templateId] ?? getLocale('en').wordProblems.templates[prompt.templateId] ?? prompt.templateId;
  const person = bank.names[prompt.nameSeed % bank.names.length] ?? { n: '?', g: 'f' as const };
  return formatMessage(tpl, { ...prompt.vars, name: person.n, g: person.g }, formatEnv(locale));
}

const OPS = new Set(['+', '-', '*', '/']);

/** Worked-step sentence; an `op` param is replaced by the locale's glyph. */
export function solutionText(step: Extract<SolutionStep, { k: 'say' }>, locale: LocaleId, band: BandId): string {
  const ops: OperatorGlyphs = getLocale(locale).ops;
  const params: Record<string, string | number> = { ...step.params };
  if (typeof params.op === 'string' && OPS.has(params.op)) params.op = ops[params.op as keyof OperatorGlyphs];
  return tk(locale, step.key, params, band);
}

/** Short on-screen instruction for B/C (Band A relies on pictures and voice). */
export function promptText(item: Item, locale: LocaleId, band: BandId): string {
  const p = item.prompt;
  const conv = getLocale(locale).numbers;
  switch (p.kind) {
    case 'count':
      return t(locale, 'prompt.count', {}, band);
    case 'locate':
      if (p.display) return t(locale, p.display.k === 'frac' ? 'frac.locate' : 'frac.locateDec', {}, band);
      return item.answer.tolerance
        ? t(locale, 'prompt.estimate', { n: p.target }, band)
        : t(locale, 'prompt.locate', { n: p.target }, band);
    case 'compare': {
      const fr = p.a.k === 'frac' || p.b.k === 'frac';
      if (p.pick === 'max') return t(locale, fr ? 'frac.biggerFrac' : 'frac.biggerDec', {}, band);
      return t(locale, fr ? 'frac.smallerFrac' : 'frac.smallerDec', {}, band);
    }
    case 'read':
      return t(locale, 'frac.read', {}, band);
    case 'percentOf':
      return t(locale, 'frac.percent', {}, band);
    case 'blocks':
      return t(locale, 'prompt.blocks', {}, band);
    case 'groups':
      return t(locale, 'prompt.groups', { groups: p.groups, size: p.size }, band);
    case 'word':
      return wordProblemText(p, locale);
    case 'custom':
      return getCustomPrompt(p.type)?.text(p, item, locale, band) ?? t(locale, 'prompt.custom', {}, band);
    case 'expr':
      if (p.rhs?.k === 'frac') return t(locale, 'frac.equiv', {}, band);
      if (p.rhs) return t(locale, 'prompt.bond', {}, band);
      if (item.line.answerMode === 'count') {
        return t(locale, 'prompt.divide', { size: item.line.hopSize ?? 1, target: item.line.flag ?? 0 }, band);
      }
      void conv;
      return t(locale, 'prompt.land', {}, band);
  }
}

/** The voice line (key + params) for a custom prompt; null when it has none or its type is unregistered. */
export function customVoice(item: Item): { key: string; params?: Record<string, number> } | null {
  const p = item.prompt;
  if (p.kind !== 'custom') return null;
  return getCustomPrompt(p.type)?.spoken?.(p, item) ?? null;
}

/**
 * The voice line (a `voice.*` key and numeric params, recordable as clips) a
 * pre-reader hears for this prompt; null for word problems (read out as text)
 * and prompts with nothing to say.
 */
export function promptVoice(item: Item): { key: string; params: Record<string, number> } | null {
  const p = item.prompt;
  switch (p.kind) {
    case 'custom': {
      const v = customVoice(item);
      return v ? { key: v.key, params: v.params ?? {} } : null;
    }
    case 'count':
      return { key: 'voice.count', params: {} };
    case 'locate':
      if (p.display?.k === 'frac' && p.display.n !== null) return { key: 'voice.frac.hopTo', params: { n: p.display.n, d: p.display.d } };
      return { key: 'voice.locate', params: { n: p.target } };
    case 'blocks':
      return { key: 'voice.blocks', params: {} };
    case 'groups':
      return { key: 'voice.groups', params: { n: p.groups, size: p.size } };
    case 'compare':
      return { key: p.pick === 'max' ? 'voice.frac.bigger' : 'voice.frac.smaller', params: {} };
    case 'read':
      return { key: 'voice.frac.flag', params: {} };
    case 'percentOf':
    case 'word':
      return null;
    case 'expr': {
      const e = p.expr;
      if (p.rhs?.k === 'frac') return { key: 'voice.frac.flag', params: {} };
      if (e.k !== 'op') return null;
      const a = e.a.k === 'num' ? e.a.v : 0;
      const b = e.b.k === 'num' ? e.b.v : 0;
      if (p.rhs && p.rhs.k === 'num') return { key: 'voice.bond', params: { a, total: p.rhs.v } };
      const key = ({ '+': 'voice.add', '-': 'voice.sub', '*': 'voice.mul', '/': 'voice.div' } as const)[e.op];
      return { key, params: { a, b } };
    }
  }
}

/** What Band A hears, as text (speech-synthesis fallback). */
export function spokenPrompt(item: Item, locale: LocaleId): string {
  const p = item.prompt;
  if (p.kind === 'word') return wordProblemText(p, locale);
  const v = promptVoice(item);
  return v ? tk(locale, v.key, v.params) : '';
}

/** An expression as inline text: "3/4", "0,45", "?/12". */
export function exprText(e: Expr, locale: LocaleId): string {
  return tokensText(exprTokens(e, locale));
}

/** How the item writes its answer: the prompt's own form (3/4 stays 3/4, never "0,75"). */
function answerForm(item: Item): Expr | null {
  const p = item.prompt;
  const v = item.answer.value.n / item.answer.value.d;
  const same = (e: Expr): boolean => e.k !== 'op' && e.k !== 'blank' && !(e.k === 'frac' && e.n === null) && Math.abs(valueOf(e) - v) < 1e-9;
  if (p.kind === 'locate' && p.display && same(p.display)) return p.display;
  if (p.kind === 'compare') return same(p.a) ? p.a : same(p.b) ? p.b : null;
  return null;
}
const valueOf = (e: Expr): number => (e.k === 'num' ? e.v : e.k === 'frac' ? (e.n ?? NaN) / e.d : NaN);

export function answerText(item: Item, locale: LocaleId): string {
  const form = answerForm(item);
  return form ? exprText(form, locale) : formatRational(item.answer.value, getLocale(locale).numbers);
}

/**
 * A position on a line, written the way that line writes it: k/den on a
 * fraction line (unreduced, like its ticks: "8/12"), a decimal on a decimal
 * line, a plain number otherwise.
 */
export function lineValueText(v: number, line: LineSpec, locale: LocaleId): string {
  const conv = getLocale(locale).numbers;
  if (line.den && line.labelStyle === 'fraction') {
    const k = Math.round(v * line.den);
    return k % line.den === 0 ? formatNumber(k / line.den, conv) : formatFraction(k, line.den, conv);
  }
  return formatNumber(line.den ? Math.round(v * line.den) / line.den : v, conv, { maximumFractionDigits: 6 });
}

/** "25%" / "25 %" (the locale's percent convention). */
export function percentText(p: number, locale: LocaleId): string {
  return formatPercent(p, getLocale(locale).numbers);
}

export function numberText(n: number, locale: LocaleId, maxFrac = 6): string {
  return formatNumber(n, getLocale(locale).numbers, { maximumFractionDigits: maxFrac });
}
