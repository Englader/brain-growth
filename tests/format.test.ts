import { describe, expect, it } from 'vitest';
import { formatMessage, argumentNames, type FormatEnv } from '../src/i18n/format';

const env = (locale: string): FormatEnv => ({
  pluralRules: new Intl.PluralRules(locale),
  formatNumber: (n) => String(n),
});

describe('formatMessage', () => {
  it('interpolates', () => {
    expect(formatMessage('Hi {name}!', { name: 'Ана' }, env('mk'))).toBe('Hi Ана!');
  });
  it('leaves unknown args visible rather than blank (fail loud in QA)', () => {
    expect(formatMessage('{x} left', {}, env('en'))).toBe('{x} left');
  });
  it('Macedonian plural: 1, 21, 31 are "one"; 11 is "other"', () => {
    const msg = '{n, plural, one {# денар} other {# денари}}';
    expect(formatMessage(msg, { n: 1 }, env('mk'))).toBe('1 денар');
    expect(formatMessage(msg, { n: 21 }, env('mk'))).toBe('21 денар');
    expect(formatMessage(msg, { n: 11 }, env('mk'))).toBe('11 денари');
    expect(formatMessage(msg, { n: 5 }, env('mk'))).toBe('5 денари');
  });
  it('English plural', () => {
    const msg = '{n, plural, =0 {no stars} one {# star} other {# stars}}';
    expect(formatMessage(msg, { n: 0 }, env('en'))).toBe('no stars');
    expect(formatMessage(msg, { n: 1 }, env('en'))).toBe('1 star');
    expect(formatMessage(msg, { n: 21 }, env('en'))).toBe('21 stars');
  });
  it('select for grammatical gender', () => {
    const msg = '{name} и баба {g, select, f {ѝ} other {му}}';
    expect(formatMessage(msg, { name: 'Ана', g: 'f' }, env('mk'))).toBe('Ана и баба ѝ');
    expect(formatMessage(msg, { name: 'Марко', g: 'm' }, env('mk'))).toBe('Марко и баба му');
  });
  it('nested select inside plural', () => {
    const msg = '{n, plural, one {{g, select, f {една} other {еден}}} other {#}}';
    expect(formatMessage(msg, { n: 1, g: 'f' }, env('mk'))).toBe('една');
    expect(formatMessage(msg, { n: 3, g: 'f' }, env('mk'))).toBe('3');
  });
  it('rejects malformed messages', () => {
    expect(() => formatMessage('{n, plural, one {x}}', { n: 1 }, env('en'))).toThrow();
    expect(() => formatMessage('oops }', {}, env('en'))).toThrow();
  });
  it('lists argument names for parity checks', () => {
    expect(argumentNames('{a} {n, plural, one {{b}} other {#}} {g, select, f {x} other {{c}}}')).toEqual([
      'a', 'b', 'c', 'g', 'n',
    ]);
  });
});
