import { describe, expect, it } from 'vitest';
import {
  allRects,
  checkFracBar,
  checkFracBarRepr,
  checkRect,
  checkRectRepr,
  exampleRect,
  FRAC_BAR_CHECK_ID,
  fracBarChecker,
  fracBarData,
  fracBarRepr,
  fracBarSolutionSteps,
  fracBarValue,
  makeFracBar,
  makeRect,
  MAX_BAR_PARTS,
  parseFracBarRepr,
  perimeterHops,
  readFracBarData,
  readRectData,
  RECT_CHECK_ID,
  rectChecker,
  RECT_GRIDS,
  RECT_MAX_SIDE,
  rectData,
  rectSolutionSteps,
  WORKSHOP_MIS_KEYS,
  WORKSHOP_SOL_KEYS,
  type FracSkill,
  type MadeFracBar,
  type MadeRect,
  type Rect,
  type RectConstraints,
  type RectSkill,
} from '../src/core/workshop';
import type { Item } from '../src/core/items/types';
import { rat } from '../src/core/rational';
import { createRng } from '../src/core/rng';
import { getLocale } from '../src/i18n/locales';

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Every fraction n/d with 0 ≤ n ≤ d ≤ MAX_BAR_PARTS in lowest terms. */
function reducedFractions(): Array<{ n: number; d: number }> {
  const out: Array<{ n: number; d: number }> = [];
  for (let d = 1; d <= MAX_BAR_PARTS; d++) for (let n = 0; n <= d; n++) if (gcd(n, d) === 1) out.push({ n, d });
  return out;
}

describe('workshop: fraction bar checker', () => {
  it('accepts every equivalent construction and rejects every other one', () => {
    const bad: string[] = [];
    for (const t of reducedFractions()) {
      for (let parts = 1; parts <= MAX_BAR_PARTS; parts++) {
        for (let c = 0; c <= parts; c++) {
          const equivalent = c * t.d === t.n * parts;
          const byCount = checkFracBar(t, { parts, shaded: c });
          // Shade every other part first, so indices are not contiguous.
          const idx = [...Array.from({ length: parts }, (_, i) => i).filter((i) => i % 2 === 0), ...Array.from({ length: parts }, (_, i) => i).filter((i) => i % 2 === 1)].slice(0, c);
          const byIndex = checkFracBar(t, { parts, shaded: idx });
          for (const r of [byCount, byIndex]) {
            const amountOk = r.amount !== null && r.amount.n * parts === c * r.amount.d;
            if (r.invalid || r.ok !== equivalent || !amountOk) bad.push(`${t.n}/${t.d} ← ${c}/${parts}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
    expect(checkFracBar({ n: 1, d: 2 }, { parts: 4, shaded: [0, 3] })).toMatchObject({ ok: true, amount: rat(1, 2) });
    expect(checkFracBar({ n: 2, d: 3 }, { parts: 12, shaded: 8 }).ok).toBe(true);
    expect(checkFracBar({ n: 2, d: 3 }, { parts: 12, shaded: 7 }).ok).toBe(false);
  });

  it('insists on the required number of parts', () => {
    const t = { n: 2, d: 3, parts: 6 };
    expect(checkFracBar(t, { parts: 6, shaded: 4 }).ok).toBe(true);
    expect(checkFracBar(t, { parts: 3, shaded: 2 })).toMatchObject({ ok: false, reason: 'wrongParts' });
    expect(checkFracBar(t, { parts: 12, shaded: 8 })).toMatchObject({ ok: false, reason: 'wrongParts' });
    // Scale down: 6/8 with 4 parts.
    expect(checkFracBar({ n: 6, d: 8, parts: 4 }, { parts: 4, shaded: [1, 2, 3] }).ok).toBe(true);
  });

  it('names the misconceptions', () => {
    // Shaded the unshaded share.
    expect(checkFracBar({ n: 1, d: 4 }, { parts: 4, shaded: 3 }).misconception).toBe('frac.partsVsShaded');
    expect(checkFracBar({ n: 2, d: 5 }, { parts: 10, shaded: 6 }).misconception).toBe('frac.partsVsShaded');
    // Shaded : unshaded read as the fraction (1 of 4 shaded for 1/3).
    expect(checkFracBar({ n: 1, d: 3 }, { parts: 4, shaded: 1 }).misconception).toBe('frac.partsVsShaded');
    // More parts, same number shaded.
    expect(checkFracBar({ n: 2, d: 3, parts: 6 }, { parts: 6, shaded: 2 }).misconception).toBe('frac.numeratorKept');
    // Unequal pieces counted as equal: [½, ¼, ¼] with one quarter shaded is not 1/3.
    expect(checkFracBar({ n: 1, d: 3 }, { parts: 3, shaded: [1], sizes: [2, 1, 1] })).toMatchObject({
      ok: false,
      reason: 'unequal',
      misconception: 'frac.unequalParts',
    });
    // …but shading the half of an unequal split is a correct half.
    expect(checkFracBar({ n: 1, d: 2 }, { parts: 3, shaded: [0], sizes: [2, 1, 1] }).ok).toBe(true);
    expect(checkFracBar({ n: 1, d: 3 }, { parts: 3, shaded: [0], sizes: [3, 3, 3] }).ok).toBe(true);
    expect(checkFracBar({ n: 3, d: 5 }, { parts: 5, shaded: 1 }).misconception).toBeNull();
  });

  it('treats unreadable constructions as invalid', () => {
    const t = { n: 1, d: 2 };
    for (const g of [
      { parts: 0, shaded: 0 },
      { parts: MAX_BAR_PARTS + 1, shaded: 1 },
      { parts: 2.5, shaded: 1 },
      { parts: 4, shaded: 5 },
      { parts: 4, shaded: -1 },
      { parts: 4, shaded: [0, 0] },
      { parts: 4, shaded: [4] },
      { parts: 4, shaded: [1.5] },
      { parts: 3, shaded: 1, sizes: [2, 1, 1] },
      { parts: 3, shaded: [0], sizes: [2, 1] },
      { parts: 2, shaded: [0], sizes: [0, 1] },
    ]) {
      expect(checkFracBar(t, g), JSON.stringify(g)).toMatchObject({ ok: false, invalid: true, reason: 'parse' });
    }
  });

  it('reads and writes the repr, and checks from item data', () => {
    expect(fracBarRepr({ parts: 6, shaded: [4, 0, 2] })).toBe('6|0,2,4');
    expect(fracBarRepr({ parts: 4, shaded: 0 })).toBe('4|');
    expect(fracBarRepr({ parts: 3, shaded: [0], sizes: [2, 1, 1] })).toBe('2+1+1|0');
    expect(parseFracBarRepr('2+1+1|0')).toEqual({ parts: 3, shaded: [0], sizes: [2, 1, 1] });
    expect(parseFracBarRepr('6|0,2,4')).toEqual({ parts: 6, shaded: [0, 2, 4] });
    for (const bad of ['', '6', '|1', '6|a', '6|1,', 'x|1']) expect(parseFracBarRepr(bad), bad).toBeNull();
    const data = fracBarData({ n: 2, d: 3, parts: 6 });
    expect(data).toEqual({ n: 2, d: 3, parts: 6 });
    expect(checkFracBarRepr(data, '6|0,1,4,5')).toMatchObject({ ok: true, given: '6|0,1,4,5' });
    expect(checkFracBarRepr(data, '6|0,1')).toMatchObject({ ok: false, misconception: 'frac.numeratorKept' });
    expect(checkFracBarRepr({ n: 1, d: 2, parts: 0 }, '8|0,1,2,3').ok).toBe(true);
    expect(checkFracBarRepr({ n: 3, d: 2 }, '2|0').invalid).toBe(true);
    expect(checkFracBarRepr(data, 'nope').invalid).toBe(true);
    expect(readFracBarData({ n: 1, d: 4 })).toEqual({ n: 1, d: 4 });
  });
});

describe('workshop: fraction bar generator', () => {
  const SK: FracSkill[] = ['f.unit', 'f.equiv'];

  it('makes buildable targets', () => {
    for (const skill of SK) {
      const rng = createRng(skill === 'f.unit' ? 1 : 2);
      for (let i = 0; i < 600; i++) {
        const m = makeFracBar(rng, skill, (i % 11) / 10);
        const { n, d, parts } = m.target;
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThan(d);
        const P = parts ?? d;
        expect(P).toBeLessThanOrEqual(MAX_BAR_PARTS);
        expect((n * P) % d).toBe(0); // the answer is a whole number of parts
        expect(checkFracBar(m.target, { parts: P, shaded: (n * P) / d }).ok).toBe(true);
        if (skill === 'f.unit') expect(m.task).toBe('make');
        else expect(['scaleUp', 'scaleDown']).toContain(m.task);
        if (m.task === 'scaleUp') expect(P).toBeGreaterThan(d);
        if (m.task === 'scaleDown') expect(P).toBeLessThan(d);
        expect(fracBarValue(m.target).d).toBeLessThanOrEqual(6 + (skill === 'f.unit' ? 4 : 0));
        for (const s of fracBarSolutionSteps(m.task, m.target)) {
          if (s.k === 'say') expect(Object.values(WORKSHOP_SOL_KEYS)).toContain(s.key);
        }
      }
    }
  });

  it('is deterministic, and difficulty rises with the level', () => {
    for (const skill of SK) {
      expect(makeFracBar(createRng(5), skill, 0.6)).toEqual(makeFracBar(createRng(5), skill, 0.6));
      const at = (lv: number): MadeFracBar[] => {
        const rng = createRng(40 + Math.round(lv * 100));
        return Array.from({ length: 150 }, () => makeFracBar(rng, skill, lv));
      };
      const mean = (xs: MadeFracBar[], f: (m: MadeFracBar) => number): number => xs.reduce((s, m) => s + f(m), 0) / xs.length;
      const rows = [0.1, 0.3, 0.5, 0.7, 0.9].map(at);
      const lv = rows.map((r) => mean(r, (m) => m.achievedLevel));
      for (let i = 1; i < lv.length; i++) expect(lv[i]!).toBeGreaterThan(lv[i - 1]!);
      const nonUnit = rows.map((r) => mean(r, (m) => m.features.unit === 0 ? 1 : 0));
      expect(nonUnit[0]!).toBeLessThan(nonUnit[4]!);
      if (skill === 'f.equiv') {
        const down = rows.map((r) => mean(r, (m) => (m.task === 'scaleDown' ? 1 : 0)));
        expect(down[0]!).toBeLessThan(0.1);
        expect(down[4]!).toBeGreaterThan(0.9);
      } else {
        expect(mean(rows[0]!, (m) => m.target.d)).toBeLessThan(mean(rows[2]!, (m) => m.target.d));
      }
    }
  });
});

describe('workshop: rectangles', () => {
  const brute = (c: RectConstraints): Rect[] => {
    const out: Rect[] = [];
    for (let w = 1; w <= c.maxSide; w++) {
      for (let h = 1; h <= c.maxSide; h++) {
        if ((c.area === undefined || w * h === c.area) && (c.perimeter === undefined || 2 * (w + h) === c.perimeter)) out.push({ w, h });
      }
    }
    return out;
  };

  it('allRects is complete (brute force) and the checker accepts exactly those', () => {
    const cases: RectConstraints[] = [];
    for (let maxSide = 1; maxSide <= RECT_MAX_SIDE; maxSide++) {
      for (let area = 1; area <= 150; area++) cases.push({ area, maxSide });
      for (let perimeter = 1; perimeter <= 50; perimeter++) cases.push({ perimeter, maxSide });
      for (let area = 1; area <= 60; area++) for (let perimeter = 4; perimeter <= 40; perimeter += 2) cases.push({ area, perimeter, maxSide });
    }
    cases.push({ maxSide: 4 });
    const bad: string[] = [];
    for (const c of cases) {
      const want = brute(c);
      const got = allRects(c);
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`allRects ${JSON.stringify(c)}`);
      const valid = new Set(want.map((r) => `${r.w}x${r.h}`));
      for (let w = 1; w <= c.maxSide; w++) {
        for (let h = 1; h <= c.maxSide; h++) {
          const r = checkRect(c, { w, h });
          if (r.invalid || r.ok !== valid.has(`${w}x${h}`)) bad.push(`check ${JSON.stringify(c)} ${w}x${h}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(allRects({ area: 24, perimeter: 20, maxSide: 12 })).toEqual([
      { w: 4, h: 6 },
      { w: 6, h: 4 },
    ]);
  });

  it('detects the area/perimeter swap', () => {
    // Area 24 asked; 5×7 has perimeter 24.
    expect(checkRect({ area: 24, maxSide: 12 }, { w: 5, h: 7 })).toMatchObject({ ok: false, reason: 'area', misconception: 'workshop.areaPerimeterSwap' });
    // Perimeter 20 asked; 4×5 has area 20.
    expect(checkRect({ perimeter: 20, maxSide: 12 }, { w: 4, h: 5 })).toMatchObject({ ok: false, reason: 'perimeter', misconception: 'workshop.areaPerimeterSwap' });
    // Both asked: 2×10 has area 20 = the perimeter asked for.
    expect(checkRect({ area: 24, perimeter: 20, maxSide: 12 }, { w: 2, h: 10 }).misconception).toBe('workshop.areaPerimeterSwap');
    // Right area, wrong perimeter: no swap.
    expect(checkRect({ area: 24, perimeter: 20, maxSide: 12 }, { w: 3, h: 8 })).toMatchObject({ reason: 'perimeter', misconception: null });
    expect(checkRect({ area: 24, maxSide: 12 }, { w: 3, h: 7 }).misconception).toBeNull();
    expect(checkRect({ area: 24, maxSide: 6 }, { w: 3, h: 8 })).toMatchObject({ invalid: true, reason: 'tooBig' });
    expect(checkRect({ area: 24, maxSide: 6 }, { w: 0, h: 8 })).toMatchObject({ invalid: true, reason: 'parse' });
  });

  it('reads and writes the repr, and checks from item data', () => {
    const c: RectConstraints = { area: 24, perimeter: 20, maxSide: 8 };
    const data = rectData(c);
    expect(data).toEqual({ area: 24, perimeter: 20, maxSide: 8 });
    expect(readRectData(data)).toEqual(c);
    expect(readRectData({ area: 0, perimeter: 12, maxSide: 6 })).toEqual({ perimeter: 12, maxSide: 6 });
    expect(checkRectRepr(data, '6x4')).toMatchObject({ ok: true, given: '6x4' });
    expect(checkRectRepr(data, '4x6').ok).toBe(true);
    expect(checkRectRepr(data, '5x7').misconception).toBe('workshop.areaPerimeterSwap');
    for (const bad of ['', '4*6', '4x', 'x6', '4x6x1']) expect(checkRectRepr(data, bad).invalid, bad).toBe(true);
    expect(checkRectRepr({ area: 4, maxSide: 40 }, '2x2').invalid).toBe(true);
  });

  it('generates solvable tasks deterministically, harder with the level', () => {
    const SK: RectSkill[] = ['geo.perimeter', 'geo.area.rect'];
    for (const skill of SK) {
      const rng = createRng(skill.length);
      for (let i = 0; i < 500; i++) {
        const m = makeRect(rng, skill, (i % 11) / 10);
        const c = m.constraints;
        expect(RECT_GRIDS).toContain(c.maxSide);
        expect(allRects(c).length).toBeGreaterThan(0);
        if (skill === 'geo.perimeter') {
          expect(m.task).toBe('perimeter');
          expect(c.area).toBeUndefined();
        } else {
          expect(c.area).toBeDefined();
          expect(m.task === 'both').toBe(c.perimeter !== undefined);
        }
        const ex = exampleRect(c)!;
        expect(checkRect(c, ex).ok).toBe(true);
        for (const s of rectSolutionSteps(c)) if (s.k === 'say') expect(Object.values(WORKSHOP_SOL_KEYS)).toContain(s.key);
      }
      expect(makeRect(createRng(8), skill, 0.4)).toEqual(makeRect(createRng(8), skill, 0.4));
      const at = (lv: number): MadeRect[] => {
        const r = createRng(70 + Math.round(lv * 100));
        return Array.from({ length: 150 }, () => makeRect(r, skill, lv));
      };
      const mean = (xs: MadeRect[], f: (m: MadeRect) => number): number => xs.reduce((s, m) => s + f(m), 0) / xs.length;
      const rows = [0.1, 0.3, 0.5, 0.7, 0.9].map(at);
      const lv = rows.map((r) => mean(r, (m) => m.achievedLevel));
      for (let i = 1; i < lv.length; i++) expect(lv[i]!).toBeGreaterThan(lv[i - 1]!);
      if (skill === 'geo.perimeter') {
        const p = rows.map((r) => mean(r, (m) => m.constraints.perimeter!));
        for (let i = 1; i < p.length; i++) expect(p[i]!).toBeGreaterThan(p[i - 1]!);
      } else {
        const both = rows.map((r) => mean(r, (m) => (m.task === 'both' ? 1 : 0)));
        expect(both[0]!).toBe(0);
        expect(both[4]!).toBeGreaterThan(0.8);
      }
    }
  });

  it('walks the sides as four hops', () => {
    expect(perimeterHops(4, 6)).toEqual([
      { k: 'hop', from: 0, to: 4 },
      { k: 'hop', from: 4, to: 10 },
      { k: 'hop', from: 10, to: 14 },
      { k: 'hop', from: 14, to: 20 },
    ]);
    for (let w = 1; w <= 12; w++) {
      for (let h = 1; h <= 12; h++) {
        const hops = perimeterHops(w, h, 3);
        expect(hops[0]!.from).toBe(3);
        expect(hops.at(-1)!.to - 3).toBe(2 * (w + h));
        for (let i = 1; i < 4; i++) expect(hops[i]!.from).toBe(hops[i - 1]!.to);
      }
    }
    expect(rectSolutionSteps({ perimeter: 20, maxSide: 12 }).filter((s) => s.k === 'hop')).toHaveLength(4);
  });

  it('lists every misconception code it can emit', () => {
    expect(Object.keys(WORKSHOP_MIS_KEYS).sort()).toEqual(
      ['frac.numeratorKept', 'frac.partsVsShaded', 'frac.unequalParts', 'workshop.areaPerimeterSwap'].sort(),
    );
    for (const [code, key] of Object.entries(WORKSHOP_MIS_KEYS)) expect(key).toBe(`mis.${code}`);
  });
});

describe('workshop: registry adapters', () => {
  it('grade built bars and rectangles from params and repr', () => {
    const item = {} as Item;
    const conv = getLocale('mk').numbers;
    const built = (r: string) => ({ kind: 'built' as const, value: null, repr: r });
    const frac: Record<string, number> = fracBarData({ n: 2, d: 3, parts: 6 });
    expect(fracBarChecker(item, built('6|0,1,2,3'), frac, conv)).toEqual({
      correct: true,
      invalid: false,
      given: '6|0,1,2,3',
      misconception: null,
      delta: 0,
    });
    expect(fracBarChecker(item, built('6|0,1'), frac, conv)).toMatchObject({ correct: false, misconception: 'frac.numeratorKept' });
    expect(fracBarChecker(item, built('6|9'), frac, conv)).toMatchObject({ invalid: true });
    const rect: Record<string, number> = rectData({ area: 24, perimeter: 20, maxSide: 8 });
    expect(rectChecker(item, built('6x4'), rect, conv)).toEqual({
      correct: true,
      invalid: false,
      given: '6x4',
      misconception: null,
      delta: null,
    });
    expect(rectChecker(item, built('3x8'), rect, conv)).toMatchObject({ correct: false, misconception: null });
    expect(rectChecker(item, built('9x9'), rect, conv)).toMatchObject({ invalid: true });
    expect(rectChecker(item, { kind: 'typed', raw: '24' }, rect, conv)).toMatchObject({ invalid: true });
    expect([FRAC_BAR_CHECK_ID, RECT_CHECK_ID]).toEqual(['workshop.frac', 'workshop.rect']);
  });
});
