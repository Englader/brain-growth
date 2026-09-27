/**
 * Translation runtime. Band-specific TONE is a lookup rule, not code:
 * t('home.greeting') for a Band C player first tries 'home.greeting@C'.
 */
import type { BandId, LocaleId } from '../core/types';
import type en from './locales/en.json';
import { formatMessage, type FormatEnv, type MessageParams } from './format';
import { getLocale, isLocaleLoaded, loadedLocales, loadLocale, SOURCE_LOCALE } from './locales';
import { formatNumber, formatPercent } from './numbers';

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
      formatPercent: (n) => formatPercent(n, cfg.numbers),
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

/**
 * The locale that can speak for `locale` right now: itself once its bundle is
 * in, else the source locale, else any loaded one; null before any bundle
 * arrived. Bundles load on demand (locales.ts), so a screen asked for a
 * language still on its way keeps the one on screen: never raw keys.
 */
export function speakingLocale(locale: LocaleId): LocaleId | null {
  if (isLocaleLoaded(locale)) return locale;
  if (isLocaleLoaded(SOURCE_LOCALE)) return SOURCE_LOCALE;
  return loadedLocales()[0] ?? null;
}

/**
 * Translate a dynamic key (skill/achievement ids). Parity tests guarantee coverage.
 * Before any bundle has loaded it returns '' (the boot splash has no text).
 */
export function tk(locale: LocaleId, key: string, params: MessageParams = {}, band?: BandId): string {
  const loc = speakingLocale(locale);
  if (loc === null) return '';
  let msg = lookup(loc, key, band);
  if (msg === undefined && loc !== SOURCE_LOCALE && isLocaleLoaded(SOURCE_LOCALE)) msg = lookup(SOURCE_LOCALE, key, band);
  if (msg === undefined) {
    if (!missing.has(key)) {
      missing.add(key);
      if (import.meta.env?.DEV) console.warn(`[i18n] missing key ${key}`);
    }
    return key;
  }
  return formatMessage(msg, params, formatEnv(loc));
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

/**
 * A translator for `locale` and `band`. If the locale's bundle is not in yet
 * it starts loading it; until then the translator speaks the locale already
 * on screen (speakingLocale), and the store re-renders when it arrives.
 */
export function makeT(locale: LocaleId, band: BandId): Translator {
  if (!isLocaleLoaded(locale)) void loadLocale(locale).catch(() => undefined);
  const fn = ((key: MessageKey, params?: MessageParams) => t(locale, key, params, band)) as Translator;
  fn.dyn = (key, params) => tk(locale, key, params, band);
  fn.locale = locale;
  fn.band = band;
  return fn;
}
