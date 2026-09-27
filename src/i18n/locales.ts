/**
 * Locale registry. A locale is: a message bundle, a word-problem bank,
 * number conventions, operator glyphs, and the speech languages to look for.
 * Adding a third language = one JSON bundle + one word-problem bank + one
 * entry here. The parity and font-coverage tests then tell you what is missing.
 *
 * The bundles are loaded on demand (DESIGN §1.12, "Loading"): each locale's
 * messages and word problems are their own chunk, fetched by loadLocale().
 * main.tsx loads the active locale before the first screen and prefetches
 * the others when the browser is idle; until a bundle is in, `messages` is
 * empty and `loaded` false. Node callers (tests, scripts) run loadAllLocales().
 */
import type { LocaleId } from '../core/types';
import { POINT_NOTATIONS, type PointNotation } from '../core/coord/notation';
import type { NumberConventions } from './numbers';

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
  /** How a point is written, "(3, −2)" or "(3; −2)" (src/core/coord/notation.ts); default by locale id. */
  point?: PointNotation;
  ops: OperatorGlyphs;
  /** Speech-synthesis languages to accept, in preference order. Never a different language. */
  speech: readonly string[];
  /** Flattened messages ('home.greeting' → text); empty until the bundle is loaded. */
  messages: Record<string, string>;
  /** Word-problem bank; empty until the bundle is loaded. */
  wordProblems: WordProblemBank;
  /** Whether messages and wordProblems are in (loadLocale). */
  loaded: boolean;
  /** Fetches the bundle chunk: `() => Promise.all([import('./locales/xx.json'), import('./wordproblems/xx.json')])`. */
  load: () => Promise<[{ default: object }, { default: object }]>;
}

/** What a locale registers: everything but the bundle, which loadLocale() fills in. */
export type LocaleDef = Omit<LocaleConfig, 'messages' | 'wordProblems' | 'loaded'>;

export function flatten(obj: Nested, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

const registry = new Map<LocaleId, LocaleConfig>();

export function registerLocale(def: LocaleDef): void {
  registry.set(def.id, { ...def, messages: {}, wordProblems: { names: [], templates: {} }, loaded: false });
}

export function getLocale(id: LocaleId): LocaleConfig {
  return registry.get(id) ?? registry.get(SOURCE_LOCALE)!;
}

export function allLocales(): LocaleConfig[] {
  return [...registry.values()];
}

export const SOURCE_LOCALE = 'en';

const pending = new Map<LocaleId, Promise<void>>();
const listeners = new Set<(id: LocaleId) => void>();

export function isLocaleLoaded(id: LocaleId): boolean {
  return registry.get(id)?.loaded ?? false;
}

/** Ids of the locales whose bundles are in, in registration order. */
export function loadedLocales(): LocaleId[] {
  return allLocales().filter((l) => l.loaded).map((l) => l.id);
}

/**
 * Load a locale's bundle (an unknown id loads the source locale). Resolves at
 * once when it is already in; concurrent calls share one fetch; a failed
 * fetch rejects and may be retried.
 */
export function loadLocale(id: LocaleId): Promise<void> {
  const cfg = getLocale(id);
  if (cfg.loaded) return Promise.resolve();
  let p = pending.get(cfg.id);
  if (!p) {
    p = cfg.load().then(([msgs, wp]) => {
      cfg.messages = flatten(msgs.default as Nested);
      cfg.wordProblems = wp.default as WordProblemBank;
      cfg.loaded = true;
      for (const l of listeners) l(cfg.id);
    });
    pending.set(cfg.id, p);
    p.catch(() => pending.delete(cfg.id));
  }
  return p;
}

export function loadAllLocales(): Promise<void> {
  return Promise.all(allLocales().map((l) => loadLocale(l.id))).then(() => undefined);
}

/** Called with the id of each locale as its bundle arrives. Returns an unsubscribe function. */
export function onLocaleLoaded(fn: (id: LocaleId) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

registerLocale({
  id: 'en',
  bcp47: 'en-US',
  nativeName: 'English',
  short: 'EN',
  numbers: { bcp47: 'en-US', decimal: '.', group: ',', minimumGroupingDigits: 1, minus: '−', percent: '%' },
  ops: { '+': '+', '-': '−', '*': '×', '/': '÷', '=': '=' },
  point: POINT_NOTATIONS.en,
  speech: ['en-US', 'en-GB', 'en-AU', 'en-IE', 'en'],
  load: () => Promise.all([import('./locales/en.json'), import('./wordproblems/en.json')]),
});

registerLocale({
  id: 'mk',
  bcp47: 'mk-MK',
  nativeName: 'Македонски',
  short: 'МК',
  // Space grouping (not '.') keeps "1.234" from ever looking like a decimal to a child.
  // No-break space rather than the typographically nicer U+202F: neither self-hosted
  // font has U+202F (caught by tests/i18n.test.ts), and thin U+2009 can wrap mid-number.
  // Percent: Macedonian orthography separates the sign from the number; a no-break
  // space ("25 %") so the sign never wraps onto its own line (DESIGN §1.12).
  numbers: { bcp47: 'mk-MK', decimal: ',', group: '\u00A0', minimumGroupingDigits: 2, minus: '−', percent: '\u00A0%' },
  // Macedonian schooling writes multiplication as · and division as :
  ops: { '+': '+', '-': '−', '*': '·', '/': ':', '=': '=' },
  // "(3, −2)" as in the МОН одделение 6 textbook; "(1,5; −2)" once a decimal comma appears.
  point: POINT_NOTATIONS.mk,
  speech: ['mk-MK', 'mk'],
  load: () => Promise.all([import('./locales/mk.json'), import('./wordproblems/mk.json')]),
});
