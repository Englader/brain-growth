/**
 * Locale registry. A locale is: a message bundle, a word-problem bank,
 * number conventions, operator glyphs, and the speech languages to look for.
 * Adding a third language = one JSON bundle + one word-problem bank + one
 * entry here. The parity and font-coverage tests then tell you what is missing.
 */
import type { LocaleId } from '../core/types';
import en from './locales/en.json';
import mk from './locales/mk.json';
import type { NumberConventions } from './numbers';
import enWP from './wordproblems/en.json';
import mkWP from './wordproblems/mk.json';

export interface WordProblemBank {
  names: Array<{ n: string; g: 'f' | 'm' }>;
  templates: Record<string, string>;
}

export interface OperatorGlyphs {
  '+': string;
  '-': string;
  '*': string;
  '/': string;
  '=': string;
}

type Nested = { [k: string]: string | Nested };

export interface LocaleConfig {
  id: LocaleId;
  bcp47: string;
  nativeName: string;
  /** Short label on the always-visible language toggle. */
  short: string;
  numbers: NumberConventions;
  ops: OperatorGlyphs;
  /** Speech-synthesis languages to accept, in preference order. Never a different language. */
  speech: readonly string[];
  messages: Record<string, string>;
  wordProblems: WordProblemBank;
}

export function flatten(obj: Nested, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

const registry = new Map<LocaleId, LocaleConfig>();

export function registerLocale(cfg: LocaleConfig): void {
  registry.set(cfg.id, cfg);
}

export function getLocale(id: LocaleId): LocaleConfig {
  return registry.get(id) ?? registry.get(SOURCE_LOCALE)!;
}

export function allLocales(): LocaleConfig[] {
  return [...registry.values()];
}

export const SOURCE_LOCALE = 'en';

registerLocale({
  id: 'en',
  bcp47: 'en-US',
  nativeName: 'English',
  short: 'EN',
  numbers: { bcp47: 'en-US', decimal: '.', group: ',', minimumGroupingDigits: 1, minus: '−' },
  ops: { '+': '+', '-': '−', '*': '×', '/': '÷', '=': '=' },
  speech: ['en-US', 'en-GB', 'en-AU', 'en-IE', 'en'],
  messages: flatten(en as Nested),
  wordProblems: enWP as WordProblemBank,
});

registerLocale({
  id: 'mk',
  bcp47: 'mk-MK',
  nativeName: 'Македонски',
  short: 'МК',
  // Space grouping (not '.') keeps "1.234" from ever looking like a decimal to a child.
  // No-break space rather than the typographically nicer U+202F: neither self-hosted
  // font has U+202F (caught by tests/i18n.test.ts), and thin U+2009 can wrap mid-number.
  numbers: { bcp47: 'mk-MK', decimal: ',', group: '\u00A0', minimumGroupingDigits: 2, minus: '−' },
  // Macedonian schooling writes multiplication as · and division as :
  ops: { '+': '+', '-': '−', '*': '·', '/': ':', '=': '=' },
  speech: ['mk-MK', 'mk'],
  messages: flatten(mk as Nested),
  wordProblems: mkWP as WordProblemBank,
});
