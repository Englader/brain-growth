/**
 * Locale-aware rendering of structured items: expressions (with the locale's
 * operator glyphs), word problems (from the per-locale bank), worked-solution
 * steps and spoken prompts. Nothing here is hard-coded display text.
 */
import { getCustomPrompt } from '../core/items/customPrompts';
import type { Expr, Item, Prompt, SolutionStep } from '../core/items/types';
import type { BandId, LocaleId } from '../core/types';
import { formatMessage } from './format';
import { formatEnv, t, tk } from './i18n';
import { getLocale, type OperatorGlyphs } from './locales';
import { formatNumber, formatRational } from './numbers';

export type ExprToken =
  | { t: 'num'; s: string }
  | { t: 'op'; s: string }
  | { t: 'paren'; s: string }
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
    .map((tk) => (tk.t === 'blank' ? '?' : tk.t === 'op' ? ` ${tk.s} ` : tk.s))
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
      return item.answer.tolerance
        ? t(locale, 'prompt.estimate', { n: p.target }, band)
        : t(locale, 'prompt.locate', { n: p.target }, band);
    case 'blocks':
      return t(locale, 'prompt.blocks', {}, band);
    case 'groups':
      return t(locale, 'prompt.groups', { groups: p.groups, size: p.size }, band);
    case 'word':
      return wordProblemText(p, locale);
    case 'custom':
      return getCustomPrompt(p.type)?.text(p, item, locale, band) ?? t(locale, 'prompt.custom', {}, band);
    case 'expr':
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

/** What Band A hears. */
export function spokenPrompt(item: Item, locale: LocaleId): string {
  const p = item.prompt;
  switch (p.kind) {
    case 'custom': {
      const v = customVoice(item);
      return v ? tk(locale, v.key, v.params) : '';
    }
    case 'count':
      return t(locale, 'voice.count');
    case 'locate':
      return t(locale, 'voice.locate', { n: p.target });
    case 'blocks':
      return t(locale, 'voice.blocks');
    case 'groups':
      return t(locale, 'voice.groups', { n: p.groups, size: p.size });
    case 'word':
      return wordProblemText(p, locale);
    case 'expr': {
      const e = p.expr;
      if (e.k !== 'op') return '';
      const a = e.a.k === 'num' ? e.a.v : 0;
      const b = e.b.k === 'num' ? e.b.v : 0;
      if (p.rhs && p.rhs.k === 'num') return t(locale, 'voice.bond', { a, total: p.rhs.v });
      const key = ({ '+': 'voice.add', '-': 'voice.sub', '*': 'voice.mul', '/': 'voice.div' } as const)[e.op];
      return t(locale, key, { a, b });
    }
  }
}

export function answerText(item: Item, locale: LocaleId): string {
  return formatRational(item.answer.value, getLocale(locale).numbers);
}

export function numberText(n: number, locale: LocaleId, maxFrac = 6): string {
  return formatNumber(n, getLocale(locale).numbers, { maximumFractionDigits: maxFrac });
}
