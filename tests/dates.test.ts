/**
 * Dates in the locale's convention (src/i18n/dates.ts). Chrome has no
 * Macedonian date patterns (Intl writes "2026 M09 27" there), so Macedonian
 * dates are written by the app, the same on every browser.
 */
import { describe, expect, it } from 'vitest';
import { formatDate } from '../src/i18n/dates';
import { getLocale } from '../src/i18n/locales';

const day = new Date(2026, 8, 7, 12, 0, 0); // 7 September 2026, local time

describe('formatDate', () => {
  it('writes Macedonian dates numerically, day first: "7.9.2026", and "7.9" on a chart axis', () => {
    expect(formatDate(day, getLocale('mk'), 'medium')).toBe('7.9.2026');
    expect(formatDate(day, getLocale('mk'), 'dayMonth')).toBe('7.9');
    expect(formatDate(day.getTime(), getLocale('mk'), 'medium')).toBe('7.9.2026');
  });

  it('never writes the root-locale fallback, whatever the browser has', () => {
    const out = formatDate(day, getLocale('mk'), 'medium');
    expect(out).not.toMatch(/M09|2026-/);
  });

  it('leaves English to Intl', () => {
    expect(formatDate(day, getLocale('en'), 'medium')).toBe(new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(day));
    expect(formatDate(day, getLocale('en'), 'dayMonth')).toBe('9/7');
  });

  it('follows the declared field order', () => {
    expect(formatDate(day, { bcp47: 'x', dates: { order: 'mdy', sep: '/' } }, 'medium')).toBe('9/7/2026');
    expect(formatDate(day, { bcp47: 'x', dates: { order: 'ymd', sep: '-' } }, 'medium')).toBe('2026-9-7');
    expect(formatDate(day, { bcp47: 'x', dates: { order: 'ymd', sep: '-' } }, 'dayMonth')).toBe('9-7');
  });
});
