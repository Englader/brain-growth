import { describe, expect, it } from 'vitest';
import { parseNumberInput, formatNumber, formatRational, type NumberConventions } from '../src/i18n/numbers';
import { rat, key, type Rational } from '../src/core/rational';

const EN: NumberConventions = { bcp47: 'en-US', decimal: '.', group: ',', minimumGroupingDigits: 1, minus: '−' };
const MK: NumberConventions = { bcp47: 'mk-MK', decimal: ',', group: ' ', minimumGroupingDigits: 2, minus: '−' };

function cands(input: string, conv: NumberConventions): string[] | string {
  const r = parseNumberInput(input, conv);
  return r.ok ? r.candidates.map(key) : `!${r.reason}`;
}

describe('parseNumberInput — unambiguous forms read identically in both locales', () => {
  const cases: Array<[string, string]> = [
    ['0', '0'],
    ['7', '7'],
    ['042', '42'],
    ['3.14', '157/50'],
    ['3,14', '157/50'],
    ['0,5', '1/2'],
    ['0.5', '1/2'],
    [',5', '1/2'],
    ['.25', '1/4'],
    ['-3', '-3'],
    ['−3', '-3'], // U+2212 minus
    ['– 3', '-3'], // en dash + space
    ['-0,5', '-1/2'],
    ['12,3456', '61728/5000'.replace('61728/5000', key(rat(123456, 10000)))],
    ['1 234', '1234'],
    ['1 234', '1234'],
    ['1 234', '1234'],
    ["1'234", '1234'],
    ['1 234 567', '1234567'],
    ['1.234.567', '1234567'],
    ['1,234,567', '1234567'],
    ['1.234,5', '2469/2'],
    ['1,234.5', '2469/2'],
    ['1 234,5', '2469/2'],
    ['1 234.5', '2469/2'],
    ['0,125', '1/8'], // leading 0 ⇒ cannot be a thousands group
    ['1234,567', key(rat(1234567, 1000))], // 4-digit head ⇒ decimal
    ['5,', '5'], // trailing separator from numpad
    ['5.', '5'],
    ['3/4', '3/4'],
    ['6/8', '3/4'],
    ['1 1/2', '3/2'],
    ['-1 1/2', '-3/2'],
    ['75%', '3/4'],
    ['１２', '12'], // full-width digits (NFKC)
  ];
  for (const [input, expected] of cases) {
    it(`"${input}"`, () => {
      expect(cands(input, EN)).toEqual([expected]);
      expect(cands(input, MK)).toEqual([expected]);
    });
  }
});

describe('parseNumberInput — ambiguous "1,234" / "1.234" keeps both readings, locale first', () => {
  it('en reads "1,234" as 1234 first, 1.234 second', () => {
    expect(cands('1,234', EN)).toEqual(['1234', key(rat(1234, 1000))]);
  });
  it('mk reads "1,234" as 1.234 first, 1234 second', () => {
    expect(cands('1,234', MK)).toEqual([key(rat(1234, 1000)), '1234']);
  });
  it('en reads "1.234" as 1.234 first', () => {
    expect(cands('1.234', EN)).toEqual([key(rat(1234, 1000)), '1234']);
  });
  it('mk reads "1.234" as 1234 first', () => {
    expect(cands('1.234', MK)).toEqual(['1234', key(rat(1234, 1000))]);
  });
  it('flags ambiguity', () => {
    const r = parseNumberInput('12,500', MK);
    expect(r.ok && r.ambiguous).toBe(true);
  });
});

describe('parseNumberInput — invalid and incomplete input is never "wrong"', () => {
  const bad: Array<[string, string]> = [
    ['', '!empty'],
    ['   ', '!empty'],
    ['-', '!incomplete'],
    ['3/', '!incomplete'],
    ['%', '!incomplete'],
    ['1..2', '!invalid'],
    ['1,,2', '!invalid'],
    ['1.23.4', '!invalid'],
    ['1 23', '!invalid'],
    ['12 34', '!invalid'],
    ['abc', '!invalid'],
    ['1/0', '!invalid'],
    ['1.234,5,6', '!invalid'],
    ['--3', '!invalid'],
  ];
  for (const [input, expected] of bad) {
    it(`"${input}" → ${expected}`, () => {
      expect(cands(input, EN)).toBe(expected);
      expect(cands(input, MK)).toBe(expected);
    });
  }
});

describe('grading contract: a right answer is right in either convention', () => {
  const matches = (input: string, expected: Rational, conv: NumberConventions): boolean => {
    const r = parseNumberInput(input, conv);
    return r.ok && r.candidates.some((c) => c.n === expected.n && c.d === expected.d);
  };
  it('mk child typing the English form of 2.5 is correct', () => {
    expect(matches('2.5', rat(5, 2), MK)).toBe(true);
  });
  it('en child typing the Macedonian form of 2.5 is correct', () => {
    expect(matches('2,5', rat(5, 2), EN)).toBe(true);
  });
  it('mk child writing 1.500 for fifteen hundred is correct', () => {
    expect(matches('1.500', rat(1500), MK)).toBe(true);
  });
  it('en child writing 1,500 for fifteen hundred is correct', () => {
    expect(matches('1,500', rat(1500), EN)).toBe(true);
  });
});

describe('formatNumber', () => {
  it('en groups from 4 digits with comma, dot decimal', () => {
    expect(formatNumber(1234, EN)).toBe('1,234');
    expect(formatNumber(1234567.5, EN)).toBe('1,234,567.5');
    expect(formatNumber(3.14, EN)).toBe('3.14');
  });
  it('mk uses comma decimal and narrow-space groups from 5 digits', () => {
    expect(formatNumber(1234, MK)).toBe('1234');
    expect(formatNumber(12345, MK)).toBe('12 345');
    expect(formatNumber(1234567.25, MK)).toBe('1 234 567,25');
    expect(formatNumber(3.14, MK)).toBe('3,14');
  });
  it('uses the true minus sign', () => {
    expect(formatNumber(-5, EN)).toBe('−5');
    expect(formatNumber(-0.5, MK)).toBe('−0,5');
  });
  it('format → parse round-trips in each locale', () => {
    for (const v of [0, 7, 42, 999, 1000, 12345, 1234567, 0.5, 3.25, -17.125]) {
      for (const conv of [EN, MK]) {
        const r = parseNumberInput(formatNumber(v, conv), conv);
        expect(r.ok && r.candidates[0] && r.candidates[0].n / r.candidates[0].d).toBe(v);
      }
    }
  });
  it('formatRational renders terminating decimals as decimals, others as fractions', () => {
    expect(formatRational(rat(1, 8), MK)).toBe('0,125');
    expect(formatRational(rat(1, 3), MK)).toBe('1/3');
    expect(formatRational(rat(-2, 3), EN)).toBe('−2/3');
    expect(formatRational(rat(1, 2), EN, 'fraction')).toBe('1/2');
  });
});
