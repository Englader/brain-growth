/**
 * Translation runtime. Band-specific TONE is a lookup rule, not code:
 * t('home.greeting') for a Band C player first tries 'home.greeting@C'.
 */
import type { BandId, LocaleId } from '../core/types';
import type en from './locales/en.json';
import { formatMessage, type FormatEnv, type MessageParams } from './format';
import { getLocale, SOURCE_LOCALE } from './locales';
import { formatNumber } from './numbers';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every key in the source bundle; a typo is a compile error. */
export type MessageKey = Leaves<typeof en>;

const envCache = new Map<LocaleId, FormatEnv>();

export function formatEnv(locale: LocaleId): FormatEnv {
  let env = envCache.get(locale);
  if (!env) {
    const cfg = getLocale(locale);
    env = {
      pluralRules: new Intl.PluralRules(cfg.bcp47),
      formatNumber: (n) => formatNumber(n, cfg.numbers),
    };
    envCache.set(locale, env);
  }
  return env;
}

const missing = new Set<string>();

function lookup(locale: LocaleId, key: string, band?: BandId): string | undefined {
  const msgs = getLocale(locale).messages;
  if (band) {
    const v = msgs[`${key}@${band}`];
    if (v !== undefined) return v;
  }
  return msgs[key];
}

/** Translate a dynamic key (skill/achievement ids). Parity tests guarantee coverage. */
export function tk(locale: LocaleId, key: string, params: MessageParams = {}, band?: BandId): string {
  let msg = lookup(locale, key, band);
  if (msg === undefined && locale !== SOURCE_LOCALE) msg = lookup(SOURCE_LOCALE, key, band);
  if (msg === undefined) {
    if (!missing.has(key)) {
      missing.add(key);
      if (import.meta.env?.DEV) console.warn(`[i18n] missing key ${key}`);
    }
    return key;
  }
  return formatMessage(msg, params, formatEnv(locale));
}

export function t(locale: LocaleId, key: MessageKey, params: MessageParams = {}, band?: BandId): string {
  return tk(locale, key, params, band);
}

export function hasKey(locale: LocaleId, key: string): boolean {
  return getLocale(locale).messages[key] !== undefined;
}

export type Translator = ((key: MessageKey, params?: MessageParams) => string) & {
  dyn: (key: string, params?: MessageParams) => string;
  locale: LocaleId;
  band: BandId;
};

export function makeT(locale: LocaleId, band: BandId): Translator {
  const fn = ((key: MessageKey, params?: MessageParams) => t(locale, key, params, band)) as Translator;
  fn.dyn = (key, params) => tk(locale, key, params, band);
  fn.locale = locale;
  fn.band = band;
  return fn;
}
