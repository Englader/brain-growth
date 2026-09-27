// @vitest-environment jsdom
/**
 * Fractions and decimals on the number line (DESIGN §4 step 3):
 *  - rational lines grade exactly: a tap near 1/3 is 1/3, three hops of 1/3 are 1;
 *  - typed answers accept both decimal conventions and "1/2";
 *  - wrong answers map to the frac.* misconception codes;
 *  - Macedonian formatting: decimal comma, stacked fractions, · and :, U+2212,
 *    no-break-space grouping from 5 digits, "25 %" with a no-break space;
 *  - the ruler's tick labels are thinned to ≥ 28 px; PadsLine has one pad per k/den;
 *  - Band A voice lines compose from recordable clips.
 */
import { h, render } from 'preact';
import { describe, expect, it } from 'vitest';
import { numberClips, voiceLine } from '../src/audio/voiceScript';
import { gradeResponse, type Response } from '../src/core/items/grade';
import { hintLadder, strategyId } from '../src/core/items/hints';
import { decAddSubGen, decLineGen, percentOfGen } from '../src/core/items/generators/decimals';
import { fracLineGen } from '../src/core/items/generators/fractions';
import type { GeneratedItem, Item, LineSpec } from '../src/core/items/types';
import { frac, num } from '../src/core/items/util';
import { key, rat } from '../src/core/rational';
import { createRng } from '../src/core/rng';
import { tk } from '../src/i18n/i18n';
import { getLocale } from '../src/i18n/locales';
import { formatFraction, formatNumber, formatPercent, formatRational } from '../src/i18n/numbers';
import { answerText, exprText, exprTokens, lineValueText, promptText, promptVoice, solutionText } from '../src/i18n/render';
import { labelParts, MIN_LABEL_GAP, PadsLine, rulerLabels, snapToLine } from '../src/ui/components/NumberLine';

const EN = getLocale('en').numbers;
const MK = getLocale('mk').numbers;
const NBSP = ' ';

const asItem = (g: GeneratedItem): Item => ({ ...g, key: '1', skillId: 'f.unit', genId: 'test', genVersion: 1, seed: 1 });

/** A hand-built item: "hop to 1/3" on a line in thirds (0–1). */
function thirds(): Item {
  return asItem({
    level: 0.3,
    prompt: { kind: 'locate', target: 1 / 3, display: frac(1, 3) },
    answer: { value: rat(1, 3) },
    line: { min: 0, max: 1, start: 0, major: 1, minor: 1 / 3, labelEvery: 1, steps: [1 / 3], answerMode: 'land', den: 3, labelStyle: 'fraction', pick: 'tap' },
    solution: [],
    misconceptions: [{ value: 2 / 3, code: 'frac.countedTicks' }],
    features: {},
  });
}

/** Generate until an item matches (deterministic seeds). */
function find(gen: typeof fracLineGen | typeof decLineGen, cfg: never, pred: (g: GeneratedItem) => boolean): Item {
  for (let seed = 1; seed < 5000; seed++) {
    const g = (gen.generate as (l: number, r: ReturnType<typeof createRng>, c: never) => GeneratedItem)((seed % 11) / 10, createRng(seed), cfg);
    if (pred(g)) return asItem(g);
  }
  throw new Error('no matching item');
}

describe('exact landings on rational lines', () => {
  it('a tap near 1/3 grades exactly 1/3 (not 0.333)', () => {
    const r = gradeResponse(thirds(), { kind: 'landed', value: 0.3333333333 }, EN);
    expect(r.correct).toBe(true);
    expect(r.given).toBe('1/3');
    // A tap that is visibly closer to 2/3 is 2/3, with its misconception.
    const w = gradeResponse(thirds(), { kind: 'landed', value: 0.61 }, EN);
    expect(w.correct).toBe(false);
    expect(w.given).toBe('2/3');
    expect(w.misconception).toBe('frac.countedTicks');
  });

  it('snapToLine keeps every hop on k/den: three hops of 1/3 land exactly on 1, ten of 1/10 on 1', () => {
    const line = thirds().line;
    let p = 0;
    for (let i = 0; i < 3; i++) p = snapToLine(p + 1 / 3, line);
    expect(p).toBe(1);
    const tenths: LineSpec = { ...line, den: 10, minor: 0.1, steps: [0.1] };
    let q = 0;
    for (let i = 0; i < 10; i++) q = snapToLine(q + 0.1, tenths);
    expect(q).toBe(1); // 0.1 added ten times as floats would be 0.9999999999999999
    expect(snapToLine(1.7, line)).toBe(1); // clamped into the line
  });

  it('count items on a rational line (2/3 = ?/12): landing on the flag by hops of 1/12 is correct, typed 8 too', () => {
    const it = find(fracLineGen, { mode: 'equiv' } as never, (g) => g.line.answerMode === 'count');
    const flag = it.line.flag!;
    const den = it.line.den!;
    const hops = Math.round(flag * den);
    let pos = 0;
    for (let i = 0; i < hops; i++) pos = snapToLine(pos + it.line.hopSize!, it.line);
    expect(gradeResponse(it, { kind: 'landed', value: pos, hops }, EN).correct).toBe(true);
    expect(gradeResponse(it, { kind: 'typed', raw: String(hops) }, MK).correct).toBe(true);
    expect(key(it.answer.value)).toBe(String(hops));
  });
});

describe('typed answers: both decimal conventions, and fractions where a value is expected', () => {
  const half = (conv: typeof EN): Item =>
    asItem({
      level: 0.3,
      prompt: { kind: 'expr', expr: { k: 'op', op: '+', a: num(0.25), b: num(0.25) } },
      answer: { value: rat(1, 2) },
      line: { min: 0, max: 1, start: 0.25, major: 1, minor: 0.1, labelEvery: 1, steps: [1, 0.1, 0.01], answerMode: 'land', den: 100, labelStyle: 'decimal' },
      solution: [],
      misconceptions: [],
      features: { conv: conv === EN ? 0 : 1 },
    });
  for (const conv of [EN, MK]) {
    for (const raw of ['0,5', '0.5', '.5', ',5', '1/2', '2/4', '0,50']) {
      it(`${conv.bcp47}: "${raw}" is correct for 0.5`, () => {
        const r = gradeResponse(half(conv), { kind: 'typed', raw } as Response, conv);
        expect(r.correct).toBe(true);
        expect(r.invalid).toBe(false);
      });
    }
  }
  it('"1/" and "abc" are unreadable (ask again), never wrong', () => {
    expect(gradeResponse(half(MK), { kind: 'typed', raw: '1/' }, MK).invalid).toBe(true);
    expect(gradeResponse(half(MK), { kind: 'typed', raw: 'abc' }, MK).invalid).toBe(true);
  });
});

describe('misconception codes', () => {
  it('0.45 for "the bigger of 0.45 and 0.5" is frac.dec.longerIsLarger (tapped or typed)', () => {
    const it = find(decLineGen, { mode: 'compare' } as never, (g) => g.prompt.kind === 'compare' && g.prompt.pick === 'max' && key(g.answer.value) === '1/2' && g.misconceptions.some((m) => Math.abs(m.value - 0.45) < 1e-9));
    const tapped = gradeResponse(it, { kind: 'landed', value: 0.452 }, MK);
    expect(tapped.correct).toBe(false);
    expect(tapped.misconception).toBe('frac.dec.longerIsLarger');
    expect(gradeResponse(it, { kind: 'typed', raw: '0,45' }, MK).misconception).toBe('frac.dec.longerIsLarger');
    expect(gradeResponse(it, { kind: 'landed', value: 0.5 }, MK).correct).toBe(true);
  });

  it('0.3 for "the bigger of 0.3 and 0.45" is frac.dec.shorterIsLarger', () => {
    const it = find(decLineGen, { mode: 'compare' } as never, (g) => g.prompt.kind === 'compare' && g.prompt.pick === 'max' && g.misconceptions.some((m) => m.code === 'frac.dec.shorterIsLarger'));
    const wrong = it.misconceptions.find((m) => m.code === 'frac.dec.shorterIsLarger')!.value;
    expect(gradeResponse(it, { kind: 'landed', value: wrong }, EN).misconception).toBe('frac.dec.shorterIsLarger');
  });

  it('picking the fraction with the bigger denominator is frac.biggerDen (1/3 vs 1/5)', () => {
    const it = find(fracLineGen, { mode: 'compare' } as never, (g) => g.prompt.kind === 'compare' && g.prompt.pick === 'max' && g.misconceptions.some((m) => m.code === 'frac.biggerDen'));
    const wrong = it.misconceptions[0]!.value;
    expect(gradeResponse(it, { kind: 'landed', value: wrong }, EN).misconception).toBe('frac.biggerDen');
  });

  it('2/3 = ?/12 answered 11 is frac.addSame; 2 is frac.numeratorOnly', () => {
    const it = find(fracLineGen, { mode: 'equiv' } as never, (g) => g.prompt.kind === 'expr' && g.misconceptions.length === 3);
    const { a, b, m } = it.features as { a: number; b: number; m: number };
    expect(gradeResponse(it, { kind: 'typed', raw: String(a + b * m - b) }, MK).misconception).toBe('frac.addSame');
    expect(gradeResponse(it, { kind: 'typed', raw: String(a) }, MK).misconception).toBe('frac.numeratorOnly');
  });

  it('2,35 + 1,4 answered 2,49 is frac.dec.misaligned; 25 % of 80 answered 25 is frac.pct.asNumber', () => {
    const add = asItem(decAddSubGen.generate(0.9, createRng(3), {}));
    const mis = add.misconceptions.find((x) => x.code === 'frac.dec.misaligned');
    if (mis) expect(gradeResponse(add, { kind: 'typed', raw: formatNumber(mis.value, MK) }, MK).misconception).toBe('frac.dec.misaligned');
    let pct: Item | null = null;
    for (let s = 1; !pct && s < 2000; s++) {
      const g = percentOfGen.generate(0.4, createRng(s), {});
      if (g.prompt.kind === 'percentOf' && g.prompt.pct === 25 && g.prompt.of !== 100) pct = asItem(g);
    }
    expect(gradeResponse(pct!, { kind: 'typed', raw: '25' }, MK).misconception).toBe('frac.pct.asNumber');
  });

  it('every misconception value of 300 items per generator is off the answer and inside number range', () => {
    const gens: Array<[typeof fracLineGen | typeof decLineGen | typeof decAddSubGen, Record<string, unknown>]> = [
      [fracLineGen, { mode: 'unit' }], [fracLineGen, { mode: 'equiv' }], [fracLineGen, { mode: 'compare' }],
      [decLineGen, { mode: 'tenths' }], [decLineGen, { mode: 'compare' }], [decAddSubGen, {}], [percentOfGen, {}],
    ];
    for (const [gen, cfg] of gens) {
      for (let s = 1; s <= 300; s++) {
        const it = asItem((gen.generate as (l: number, r: ReturnType<typeof createRng>, c: unknown) => GeneratedItem)((s % 11) / 10, createRng(s), cfg));
        for (const m of it.misconceptions) {
          expect(m.code.startsWith('frac.') || m.code === 'sub.smaller_from_larger', m.code).toBe(true);
          expect(Math.abs(m.value - it.answer.value.n / it.answer.value.d)).toBeGreaterThan(1e-9);
        }
      }
    }
  });
});

describe('Macedonian rendering', () => {
  it('decimal comma, U+2212 minus, no-break-space grouping from five digits', () => {
    expect(formatRational(rat(3, 4), MK)).toBe('0,75');
    expect(formatNumber(2.35, MK)).toBe('2,35');
    expect(formatNumber(-0.5, MK)).toBe('−0,5');
    expect(formatNumber(1234, MK)).toBe('1234');
    expect(formatNumber(12345, MK)).toBe(`12${NBSP}345`);
    expect(formatNumber(12345.5, MK)).toBe(`12${NBSP}345,5`);
    expect(formatNumber(12345, EN)).toBe('12,345');
  });

  it('fractions stay fractions: stacked tokens, "3/4" as text, unreduced as written', () => {
    expect(exprTokens(frac(3, 4), 'mk')).toEqual([{ t: 'frac', n: '3', d: '4' }]);
    expect(exprTokens(frac(null, 12), 'mk')).toEqual([{ t: 'frac', n: null, d: '12' }]);
    expect(exprText(frac(6, 8), 'mk')).toBe('6/8');
    expect(formatFraction(-3, 4, MK)).toBe('−3/4');
    const unit = find(fracLineGen, { mode: 'unit' } as never, (g) => key(g.answer.value) === '3/4');
    expect(answerText(unit, 'mk')).toBe('3/4'); // never "0,75"
    expect(labelParts(3, unit.line, 'mk')).toEqual({ n: '3', d: '4' });
    expect(labelParts(4, unit.line, 'mk')).toEqual({ text: '1' });
  });

  it('operators are · and : in Macedonian, × and ÷ in English', () => {
    const mul = { k: 'op' as const, op: '*' as const, a: num(0.5), b: num(4) };
    const dv = { k: 'op' as const, op: '/' as const, a: num(80), b: num(4) };
    expect(exprText(mul, 'mk')).toBe('0,5 · 4');
    expect(exprText(dv, 'mk')).toBe('80 : 4');
    expect(exprText(mul, 'en')).toBe('0.5 × 4');
    expect(solutionText({ k: 'say', key: 'sol.frac.pctQuarter', params: { of: 80, op: '/', r: 20 } }, 'mk', 'B')).toBe(`25${NBSP}% е четвртина: 80 : 4 = 20.`);
    expect(solutionText({ k: 'say', key: 'sol.frac.pctQuarter', params: { of: 80, op: '/', r: 20 } }, 'en', 'B')).toBe('25% is one quarter: 80 ÷ 4 = 20.');
  });

  it('percent: "25 %" with a no-break space in mk (locale config), "25%" in en', () => {
    expect(MK.percent).toBe(`${NBSP}%`);
    expect(formatPercent(25, MK)).toBe(`25${NBSP}%`);
    expect(formatPercent(12.5, MK)).toBe(`12,5${NBSP}%`);
    expect(formatPercent(25, EN)).toBe('25%');
    expect(tk('mk', 'frac.pctOf', { pct: 25, of: 80 })).toBe(`25${NBSP}% од 80`);
    expect(tk('en', 'frac.pctOf', { pct: 25, of: 80 })).toBe('25% of 80');
    // An already formatted value passes through unchanged.
    expect(tk('mk', 'frac.pctOf', { pct: formatPercent(25, MK), of: 80 })).toBe(`25${NBSP}% од 80`);
  });

  it('a landing is written the way its line writes positions', () => {
    const unit = find(fracLineGen, { mode: 'unit' } as never, (g) => g.line.den === 4 && g.line.max === 1);
    expect(lineValueText(0.5, unit.line, 'mk')).toBe('2/4');
    expect(lineValueText(1, unit.line, 'mk')).toBe('1');
    const tenths = find(decLineGen, { mode: 'tenths' } as never, (g) => g.line.den === 100);
    expect(lineValueText(tenths.line.min + 0.07, tenths.line, 'mk')).toMatch(/^\d+,\d\d?$/);
  });

  it('prompt texts come from the frac block in both languages', () => {
    const cmp = find(fracLineGen, { mode: 'compare' } as never, (g) => g.prompt.kind === 'compare' && g.prompt.pick === 'max');
    expect(promptText(cmp, 'mk', 'B')).toBe('Која дропка е поголема? Слетај на неа.');
    expect(promptText(cmp, 'en', 'B')).toBe('Which fraction is bigger? Land on it.');
  });
});

describe('the ruler: integer tick loop, labels thinned to ≥ 28 px', () => {
  it('twelfths on a 316 px ruler: labels at least 28 px apart, both ends labelled, positions exact', () => {
    const line: LineSpec = { min: 0, max: 1, start: 0, major: 1, minor: 1 / 12, labelEvery: 1 / 12, steps: [1 / 12], answerMode: 'land', den: 12, labelStyle: 'fraction', pick: 'tap' };
    const labels = rulerLabels(line, 'mk', 336);
    for (let i = 1; i < labels.length; i++) expect(labels[i]!.x - labels[i - 1]!.x).toBeGreaterThanOrEqual(MIN_LABEL_GAP);
    expect(labels[0]!.k).toBe(0);
    expect(labels[labels.length - 1]!.k).toBe(12);
    expect(labels.length).toBeGreaterThan(2);
    expect(labels.slice(1, -1).every((l) => 'n' in l.parts)).toBe(true);
  });

  it('a wide line of decimal labels keeps them from touching', () => {
    const line: LineSpec = { min: 2, max: 3, start: 2, major: 0.5, minor: 0.1, labelEvery: 0.1, steps: [0.1], answerMode: 'land', den: 10, labelStyle: 'decimal' };
    const labels = rulerLabels(line, 'mk', 336);
    for (let i = 1; i < labels.length; i++) expect(labels[i]!.x - labels[i - 1]!.x).toBeGreaterThanOrEqual(MIN_LABEL_GAP);
  });

  it('whole-number lines keep their labels (0–1000 every 100)', () => {
    const line: LineSpec = { min: 0, max: 1000, start: 0, major: 100, minor: 10, labelEvery: 100, steps: [100], answerMode: 'land' };
    expect(rulerLabels(line, 'mk', 336).map((l) => l.k)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });
});

describe('Band A pads', () => {
  // jsdom has no layout: the pads' auto-scroll is a no-op here.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => undefined;
  const look = { kind: 'frog' as const, color: '#22c55e', pad: '#86efac' };
  const pads = (line: LineSpec): HTMLElement => {
    const root = document.createElement('div');
    render(h(PadsLine, { line, locale: 'mk', pos: line.start, lift: 0, look, pickable: true }), root);
    return root;
  };

  it('PadsLine has (max − min)·den + 1 pads, each labelled k/den (stacked) or a whole number', () => {
    for (const [max, den] of [[1, 4], [2, 3], [1, 12], [2, 6]] as const) {
      const line: LineSpec = { min: 0, max, start: 0, major: 1, minor: 1 / den, labelEvery: 1, steps: [1 / den], answerMode: 'land', den, labelStyle: 'fraction', pick: 'tap' };
      const root = pads(line);
      const buttons = [...root.querySelectorAll('button.pad')];
      expect(buttons.length).toBe(max * den + 1);
      expect(buttons[1]!.getAttribute('aria-label')).toBe(`1/${den}`);
      expect(buttons[den]!.getAttribute('aria-label')).toBe('1');
      expect(root.querySelectorAll('.pad .stacked').length).toBe(max * den + 1 - (max + 1));
    }
  });

  it('a decimal window 0,3–0,4 in hundredths has 11 pads', () => {
    const line: LineSpec = { min: 0.3, max: 0.4, start: 0.3, major: 0.05, minor: 0.01, labelEvery: 0.1, steps: [0.01], answerMode: 'land', den: 100, labelStyle: 'decimal', pick: 'tap' };
    const labels = [...pads(line).querySelectorAll('button.pad')].map((b) => b.getAttribute('aria-label'));
    expect(labels.length).toBe(11);
    expect(labels[0]).toBe('0,3');
    expect(labels[7]).toBe('0,37');
  });
});

describe('hint ladder on fraction lines', () => {
  it('tier 2 names the first hop the way the line writes it: 1/4, never 0,25', () => {
    const it = find(fracLineGen, { mode: 'unit' } as never, (g) => g.line.den === 4 && g.line.max === 1 && key(g.answer.value) === '3/4');
    const tier2 = hintLadder(it).find((r) => r.tier === 2)!;
    expect(tier2.hop).toEqual({ from: 0, to: 0.25 });
    expect(solutionText(tier2.say, 'mk', 'B')).toBe('Првиот скок оди од 0 до 1/4.');
    expect(solutionText(tier2.say, 'en', 'B')).toBe('The first hop goes from 0 to 1/4.');
  });

  it('every fraction and decimal item kind has its own strategy prompt', () => {
    const kinds: Array<[typeof fracLineGen | typeof decLineGen | typeof percentOfGen, Record<string, unknown>]> = [
      [fracLineGen, { mode: 'unit' }], [fracLineGen, { mode: 'equiv' }], [fracLineGen, { mode: 'compare' }],
      [decLineGen, { mode: 'tenths' }], [decLineGen, { mode: 'compare' }], [percentOfGen, {}],
    ];
    for (const [gen, cfg] of kinds) {
      for (let s = 1; s <= 40; s++) {
        const it = asItem((gen.generate as (l: number, r: ReturnType<typeof createRng>, c: unknown) => GeneratedItem)((s % 11) / 10, createRng(s), cfg));
        expect(strategyId(it), `${gen.id} ${JSON.stringify(cfg)}`).toMatch(/^frac\./);
      }
    }
  });
});

describe('Band A voice (f.unit)', () => {
  it('"Hop to 3 out of 4 parts" composes from recordable clips in both languages', () => {
    const it = find(fracLineGen, { mode: 'unit' } as never, (g) => key(g.answer.value) === '3/4');
    const v = promptVoice(it)!;
    expect(v).toEqual({ key: 'voice.frac.hopTo', params: { n: 3, d: 4 } });
    for (const loc of ['en', 'mk'] as const) {
      const tokens = voiceLine(v.key, loc)!;
      const clips = tokens.flatMap((tok) => (tok.startsWith('{') ? numberClips(v.params[tok.slice(1, -1)]!, loc)! : [tok]));
      expect(clips).toEqual(['cmd.hopTo', 'num.3', 'voice.frac.outOf', 'num.4', 'voice.frac.parts']);
    }
    expect(tk('mk', v.key, v.params)).toBe('Скокни до 3 од 4 дела!');
    expect(tk('en', v.key, v.params)).toBe('Hop to 3 out of 4 parts!');
  });
});
