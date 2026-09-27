import { describe, expect, it } from 'vitest';
import {
  checkCoord,
  checkPoint,
  COORD_CHECK_ID,
  coordChecker,
  coordData,
  COORD_MISCONCEPTIONS,
  COORD_MIS_KEYS,
  COORD_SOL_KEYS,
  coordSolutionSteps,
  DEFAULT_POINT_NOTATION,
  formatPoint,
  formatPointList,
  formatPointWith,
  makeCoordItem,
  onPlane,
  parsePointRepr,
  PLANE_MAX,
  pointRepr,
  POINT_NOTATIONS,
  quadrant,
  snapToLattice,
  type CoordItem,
  type Point,
} from '../src/core/coord';
import { ACHIEVEMENTS, evaluateAchievements, validateAchievements } from '../src/core/achievements';
import { MODE_EVIDENCE } from '../src/core/engine/params';
import { FLAGS } from '../src/core/flags';
import { hasChecker } from '../src/core/items/checkers';
import { getCustomPrompt } from '../src/core/items/customPrompts';
import { getGenerator } from '../src/core/items/generators';
import { gradeResponse } from '../src/core/items/grade';
import type { GeneratedItem, Item } from '../src/core/items/types';
import type { ItemRecord } from '../src/core/log/types';
import { createProfile } from '../src/core/profile';
import { createRng } from '../src/core/rng';
import { GRAPH } from '../src/core/skills';
import { dayKey } from '../src/core/time';
import { getLocale } from '../src/i18n/locales';
import { promptText } from '../src/i18n/render';
import '../src/modes';
import { getMode } from '../src/modes/registry';

const NBSP = ' ';
const MINUS = '−';

function lattice(): Point[] {
  const out: Point[] = [];
  for (let x = -PLANE_MAX; x <= PLANE_MAX; x++) for (let y = -PLANE_MAX; y <= PLANE_MAX; y++) out.push({ x, y });
  return out;
}

describe('coord: generator', () => {
  it('makes plot and read items on the −6…6 lattice, never with |x| = |y|', () => {
    const rng = createRng(3);
    const tasks = new Set<string>();
    for (let i = 0; i < 800; i++) {
      const it = makeCoordItem(rng, (i % 11) / 10);
      tasks.add(it.task);
      expect(onPlane(it.target)).toBe(true);
      expect(Math.abs(it.target.x)).not.toBe(Math.abs(it.target.y));
      expect(it.achievedLevel).toBeGreaterThanOrEqual(0);
      expect(it.achievedLevel).toBeLessThanOrEqual(1);
      expect(it.features.q).toBe(quadrant(it.target));
    }
    expect([...tasks].sort()).toEqual(['plot', 'read']);
  });

  it('is deterministic for a seed', () => {
    for (const lv of [0, 0.5, 1]) expect(makeCoordItem(createRng(9), lv)).toEqual(makeCoordItem(createRng(9), lv));
  });

  it('starts in quadrant I and moves to negatives, axes and quadrant III as the level rises', () => {
    const at = (lv: number): CoordItem[] => {
      const rng = createRng(100 + Math.round(lv * 100));
      return Array.from({ length: 200 }, () => makeCoordItem(rng, lv));
    };
    const mean = (xs: CoordItem[], f: (c: CoordItem) => number): number => xs.reduce((s, c) => s + f(c), 0) / xs.length;
    const rows = [0.1, 0.3, 0.5, 0.7, 0.9].map(at);
    const levels = rows.map((r) => mean(r, (c) => c.achievedLevel));
    for (let i = 1; i < levels.length; i++) expect(levels[i]!).toBeGreaterThan(levels[i - 1]!);
    const hard = rows.map((r) => mean(r, (c) => c.features.neg! + c.features.zeros!));
    expect(hard[0]!).toBeLessThan(hard[2]!);
    expect(hard[2]!).toBeLessThan(hard[4]!);
    expect(mean(rows[0]!, (c) => (c.features.q === 1 ? 1 : 0))).toBeGreaterThan(0.95);
    expect(mean(rows[4]!, (c) => (c.features.q === 3 ? 1 : 0))).toBeGreaterThan(0.5);
  });
});

describe('coord: checkPoint', () => {
  it('accepts the exact point only', () => {
    expect(checkPoint({ x: 3, y: -2 }, { x: 3, y: -2 })).toEqual({ ok: true, misconception: null, dx: 0, dy: 0 });
    expect(checkPoint({ x: 3, y: -2 }, { x: 4, y: 5 }).ok).toBe(false);
  });

  it('detects swapped coordinates', () => {
    expect(checkPoint({ x: 3, y: -2 }, { x: -2, y: 3 }).misconception).toBe('coord.swapped');
    expect(checkPoint({ x: 0, y: 4 }, { x: 4, y: 0 }).misconception).toBe('coord.swapped');
    // Swapped wins over off-by-one when both fit.
    expect(checkPoint({ x: 1, y: 2 }, { x: 2, y: 1 }).misconception).toBe('coord.swapped');
  });

  it('detects a flipped sign', () => {
    expect(checkPoint({ x: 3, y: -2 }, { x: -3, y: -2 }).misconception).toBe('coord.sign');
    expect(checkPoint({ x: 3, y: -2 }, { x: 3, y: 2 }).misconception).toBe('coord.sign');
    expect(checkPoint({ x: 0, y: 4 }, { x: 0, y: -4 }).misconception).toBe('coord.sign');
    expect(checkPoint({ x: -5, y: 0 }, { x: 5, y: 0 }).misconception).toBe('coord.sign');
    // Both signs flipped (the mirror through the origin) is also a sign error.
    expect(checkPoint({ x: 3, y: -2 }, { x: -3, y: 2 }).misconception).toBe('coord.sign');
  });

  it('detects off-by-one counting', () => {
    expect(checkPoint({ x: 3, y: 2 }, { x: 2, y: 1 }).misconception).toBe('coord.offByOne'); // counted the origin as 1
    expect(checkPoint({ x: 3, y: 2 }, { x: 4, y: 2 }).misconception).toBe('coord.offByOne');
    expect(checkPoint({ x: -4, y: 5 }, { x: -4, y: 6 }).misconception).toBe('coord.offByOne');
    expect(checkPoint({ x: 3, y: 2 }, { x: 5, y: 2 }).misconception).toBeNull();
    expect(checkPoint({ x: 3, y: 2 }, { x: -1, y: 6 }).misconception).toBeNull();
  });

  it('agrees with the definitions on the whole lattice', () => {
    const targets = lattice().filter((p) => Math.abs(p.x) !== Math.abs(p.y));
    const signOk = (a: number, b: number): boolean => a === b || (b !== 0 && a === -b);
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const t of targets) {
      for (const g of lattice()) {
        const r = checkPoint(t, g);
        const exact = g.x === t.x && g.y === t.y;
        const swapped = g.x === t.y && g.y === t.x;
        const sign = signOk(g.x, t.x) && signOk(g.y, t.y);
        const near = Math.max(Math.abs(g.x - t.x), Math.abs(g.y - t.y)) === 1;
        const expected = exact ? null : swapped ? 'coord.swapped' : sign ? 'coord.sign' : near ? 'coord.offByOne' : null;
        if (r.ok !== exact || r.dx !== g.x - t.x || r.dy !== g.y - t.y || r.misconception !== expected) {
          bad.push(`${pointRepr(t)} ← ${pointRepr(g)}: ${r.misconception}`);
        }
        if (r.misconception) seen.add(r.misconception);
      }
    }
    expect(bad).toEqual([]);
    expect([...seen].sort()).toEqual([...COORD_MISCONCEPTIONS].sort());
  });
});

describe('coord: snapping and repr', () => {
  it('snaps a tap to the nearest lattice point on the plane', () => {
    expect(snapToLattice(2.4, -0.6)).toEqual({ x: 2, y: -1 });
    expect(snapToLattice(-0.4, 0.3)).toEqual({ x: 0, y: 0 });
    expect(snapToLattice(9, -7.7)).toEqual({ x: 6, y: -6 });
    expect(Object.is(snapToLattice(-0.2, 0).x, -0)).toBe(false);
  });

  it('checks a built response from item data and repr only', () => {
    const data = { x: 3, y: -2, read: 0 };
    expect(checkCoord(data, '3,-2')).toMatchObject({ ok: true, invalid: false, given: '3,-2' });
    expect(checkCoord(data, '-2,3')).toMatchObject({ ok: false, invalid: false, misconception: 'coord.swapped' });
    for (const bad of ['', '3', '3;-2', '3,-2,1', 'x,y', '7,0', '3.5,1']) expect(checkCoord(data, bad).invalid, bad).toBe(true);
    expect(checkCoord({ x: 9, y: 0 }, '9,0').invalid).toBe(true);
    expect(checkCoord({ x: 1, y: 2, read: 2 }, '1,2').invalid).toBe(true);
    expect(parsePointRepr(pointRepr({ x: -6, y: 0 }))).toEqual({ x: -6, y: 0 });
  });
});

describe('coord: point notation', () => {
  it('writes (3, −2) in both locales for integer points, as the МОН grade-6 textbook does for mk', () => {
    expect(formatPoint({ x: 3, y: -2 }, getLocale('en'))).toBe(`(3,${NBSP}${MINUS}2)`);
    expect(formatPoint({ x: 3, y: -2 }, getLocale('mk'))).toBe(`(3,${NBSP}${MINUS}2)`);
    expect(formatPoint({ x: -1, y: 2 }, getLocale('mk'), 'А')).toBe(`А(${MINUS}1,${NBSP}2)`);
  });

  it('switches mk to a semicolon when a coordinate has a decimal comma', () => {
    expect(formatPoint({ x: 1.5, y: -2 }, getLocale('mk'))).toBe(`(1,5;${NBSP}${MINUS}2)`);
    expect(formatPoint({ x: 1.5, y: -2 }, getLocale('en'))).toBe(`(1.5,${NBSP}${MINUS}2)`);
  });

  it('lists points with the locale list separator', () => {
    const pts = [
      { name: 'A', p: { x: 1, y: 2 } },
      { name: 'B', p: { x: 3, y: 4 } },
    ];
    expect(formatPointList(pts, getLocale('mk'))).toBe(`A(1,${NBSP}2); B(3,${NBSP}4)`);
  });

  it('is configurable through the locale config', () => {
    const semi = { ...DEFAULT_POINT_NOTATION, sep: '; ' };
    expect(formatPoint({ x: 3, y: -2 }, { ...getLocale('mk'), point: semi })).toBe(`(3; ${MINUS}2)`);
    expect(formatPointWith({ x: 3, y: 4 }, { ...semi, open: '[', close: ']' }, String)).toBe('[3; 4]');
    // An unknown locale falls back to the default notation.
    expect(formatPoint({ x: 1, y: 0 }, { id: 'xx', numbers: getLocale('en').numbers })).toBe(`(1,${NBSP}0)`);
    expect(Object.keys(POINT_NOTATIONS).sort()).toEqual(['en', 'mk']);
  });
});

describe('coord: solution steps', () => {
  it('walks across, then up or down, with listed keys', () => {
    const steps = coordSolutionSteps({ x: -3, y: 0 });
    expect(steps).toEqual([
      { k: 'say', key: COORD_SOL_KEYS.across, params: { n: 3, dir: 'left' } },
      { k: 'say', key: COORD_SOL_KEYS.upDown, params: { n: 0, dir: 'none' } },
    ]);
    for (const code of COORD_MISCONCEPTIONS) expect(COORD_MIS_KEYS[code]).toBe(`mis.${code}`);
  });
});

describe('coord: registry adapter', () => {
  it('grades a built response from params and repr', () => {
    const item = {} as Item;
    const conv = getLocale('mk').numbers;
    const params: Record<string, number> = coordData({ task: 'read', target: { x: 3, y: -2 }, achievedLevel: 0.5, features: {} });
    expect(params).toEqual({ x: 3, y: -2, read: 1 });
    const built = (r: string) => ({ kind: 'built' as const, value: null, repr: r });
    expect(coordChecker(item, built('3,-2'), params, conv)).toEqual({
      correct: true,
      invalid: false,
      given: '3,-2',
      misconception: null,
      delta: null,
    });
    expect(coordChecker(item, built('-2,3'), params, conv)).toMatchObject({ correct: false, misconception: 'coord.swapped' });
    expect(coordChecker(item, built('3;-2'), params, conv)).toMatchObject({ invalid: true });
    expect(coordChecker(item, { kind: 'landed', value: 3 }, params, conv)).toMatchObject({ invalid: true });
    expect(COORD_CHECK_ID).toBe('coord.point');
  });
});

// ── Integration with the item pipeline, locales, modes and achievements ──

const T0 = new Date(2026, 9, 5, 17, 0).getTime();
const asItem = (g: GeneratedItem, seed: number): Item => ({ ...g, key: '1', skillId: 'geo.coord', genId: 'coord', genVersion: 1, seed });
const dataOf = (it: Item): { x: number; y: number; read: number } => (it.prompt.kind === 'custom' ? (it.prompt.data as { x: number; y: number; read: number }) : { x: 0, y: 0, read: 0 });

describe('coord: integration', () => {
  it('registers its checker and prompt, and grades generated items through gradeResponse', () => {
    expect(hasChecker('coord.point')).toBe(true);
    expect(getCustomPrompt('coord.point')).toBeDefined();
    const conv = getLocale('mk').numbers;
    for (let seed = 1; seed <= 40; seed++) {
      const item = asItem(getGenerator('coord').generate(seed / 40, createRng(seed), {}), seed);
      const { x, y } = dataOf(item);
      expect(gradeResponse(item, { kind: 'built', value: null, repr: `${x},${y}` }, conv)).toMatchObject({ correct: true, given: `${x},${y}` });
      expect(gradeResponse(item, { kind: 'built', value: null, repr: `${y},${x}` }, conv)).toMatchObject({ correct: false, misconception: 'coord.swapped' });
      expect(gradeResponse(item, { kind: 'built', value: null, repr: '9,9' }, conv).invalid).toBe(true);
    }
  });

  it('renders the point in the Macedonian notation in the prompt, and the locale config carries it', () => {
    expect(getLocale('mk').point).toBe(POINT_NOTATIONS.mk);
    expect(getLocale('en').point).toBe(POINT_NOTATIONS.en);
    let plotted = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const item = asItem(getGenerator('coord').generate(0.9, createRng(seed), {}), seed);
      const { x, y, read } = dataOf(item);
      if (read) continue;
      plotted++;
      const fmt = (v: number): string => (v < 0 ? `${MINUS}${-v}` : String(v));
      expect(promptText(item, 'mk', 'B')).toBe(`Означи ја точката (${fmt(x)},${NBSP}${fmt(y)}).`);
      expect(promptText(item, 'en', 'C')).toBe(`Plot the point (${fmt(x)},${NBSP}${fmt(y)}).`);
    }
    expect(plotted).toBeGreaterThan(10);
  });

  it('registers the mode: order 54, build, Bands B/C, a default-on flag, 0.75 evidence, unlock-gated', () => {
    const m = getMode('coord')!;
    expect(m).toMatchObject({ order: 54, requires: ['build'], bands: ['B', 'C'], flag: 'mode.coord', notReadyKey: 'coord.locked' });
    expect(FLAGS.find((f) => f.id === 'mode.coord')).toMatchObject({ default: true, labelKey: 'coord.flag' });
    expect(MODE_EVIDENCE.coord).toBe(0.75);
    expect(m.filter?.(GRAPH.get('geo.coord'), undefined)).toBe(true);
    expect(m.filter?.(GRAPH.get('al.eq.linear'), undefined)).toBe(false);
    const p = createProfile({ name: 'Лука', age: 10, locale: 'mk', avatar: 'color.green' }, T0);
    const placed = { ...p, placement: { done: true, state: null } };
    expect(m.ready?.(placed)).toBe(false);
    const solid = Object.fromEntries(GRAPH.effectivePrereqs('geo.coord').map((id) => [id, { proficientAt: T0 }]));
    expect(m.ready?.({ ...placed, skills: solid as unknown as typeof p.skills })).toBe(true);
  });

  it('keeps the achievement catalogue valid; coord.quadrants needs points in all four quadrants', () => {
    expect(validateAchievements(ACHIEVEMENTS)).toEqual([]);
    const profile = { ...createProfile({ name: 'Лука', age: 13, locale: 'mk', avatar: 'color.green' }, T0), band: 'C' as const };
    const rec = (answer: string): ItemRecord => ({
      type: 'item', ts: T0, sid: 's1', key: answer, skill: 'geo.coord', gen: 'coord', genV: 1, seed: 1, level: 0.5, diff: 0,
      p: 0.8, mu: 0, s2: 1, correct: false, attempt: 1, latency: 5000, hint: false, answer, expected: '0', mis: null, mode: 'coord',
      band: 'C', locale: 'mk', source: 'frontier', timed: false, input: 'tap', hops: null, alt: false,
    });
    const ctx = (log: ItemRecord[]) => ({ profile, now: T0, today: dayKey(T0), log, sessionId: 's1', graph: GRAPH, modesAvailable: 3, memo: new Map() });
    const three = [rec('2,3'), rec('-2,3'), rec('-2,-3'), rec('0,4')];
    expect(evaluateAchievements(ACHIEVEMENTS, ctx(three), 'item')).not.toContain('coord.quadrants');
    expect(evaluateAchievements(ACHIEVEMENTS, ctx([...three, rec('5,-1')]), 'item')).toContain('coord.quadrants');
  });
});
