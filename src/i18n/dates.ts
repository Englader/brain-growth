/**
 * Dates in the locale's own convention.
 *
 * Chrome's ICU data carries no Macedonian date patterns: there,
 * `Intl.DateTimeFormat('mk-MK', { dateStyle: 'medium' })` falls back to the
 * root locale and writes "2026 M09 27" (and "09-27" for a day and month),
 * while Safari writes "27 сеп. 2026 г.". A locale that declares
 * `LocaleConfig.dates` is therefore written numerically by the app itself,
 * the same on every browser ("27.9.2026", "27.9"), like its numbers
 * (./numbers.ts). A locale without it goes through Intl.
 */
import type { LocaleConfig } from './locales';

/** A numeric date pattern: field order and separator ("27.9.2026" = dmy with '.'). */
export interface DateConventions {
  order: 'dmy' | 'mdy' | 'ymd';
  sep: string;
}

/** `medium`: day, month and year (a trophy's date, the last backup). `dayMonth`: a chart axis label. */
export type DateStyle = 'medium' | 'dayMonth';

const INTL_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  medium: { dateStyle: 'medium' },
  dayMonth: { day: 'numeric', month: 'numeric' },
};

export function formatDate(date: Date | number, cfg: Pick<LocaleConfig, 'bcp47' | 'dates'>, style: DateStyle): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  const conv = cfg.dates;
  if (!conv) return new Intl.DateTimeFormat(cfg.bcp47, INTL_OPTIONS[style]).format(d);
  const day = String(d.getDate());
  const month = String(d.getMonth() + 1);
  const year = String(d.getFullYear());
  const full = { dmy: [day, month, year], mdy: [month, day, year], ymd: [year, month, day] }[conv.order];
  const parts = style === 'medium' ? full : conv.order === 'dmy' ? [day, month] : [month, day];
  return parts.join(conv.sep);
}
