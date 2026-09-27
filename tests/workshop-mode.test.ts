/**
 * Workshop mode (plan step 9a) as wired into the app: the generators and
 * their single registration of the `workshop.frac` / `workshop.rect` checkers
 * and custom prompts; the catalog bindings (and the Hop "walk the sides"
 * generator that keeps geo.perimeter off the walls list); the mode's
 * registration, readiness and skill filter; the scoring semantics (the first
 * check is the graded attempt, credit 1 − 0.25·tier at evidence weight 0.75,
 * "show me" is a wrong attempt, live = replay); the Macedonian rendering; and
 * the exploration achievement.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import '../src/modes';
import { ACHIEVEMENTS, evaluateAchievements, validateAchievements, type EvalContext } from '../src/core/achievements';
import { FLAGS, isEnabled } from '../src/core/flags';
import { glickoElo } from '../src/core/engine/glicko';
import { hintCredit } from '../src/core/engine/observe';
import { modeEvidence } from '../src/core/engine/params';
import { replay } from '../src/core/engine/replay';
import { SessionEngine, type AnswerInput, type PresentedItem } from '../src/core/engine/session';
import { hasChecker } from '../src/core/items/checkers';
import { getCustomPrompt } from '../src/core/items/customPrompts';
import { getGenerator } from '../src/core/items/generators';
import {
  fracBarOf,
  PERIMETER_HOPS_GEN,
  rectOf,
  WALK_MISCONCEPTIONS,
  WALK_PROMPT_TYPE,
  WORKSHOP_GENERATORS,
} from '../src/core/items/generators/workshop';
import { gradeResponse, type Response } from '../src/core/items/grade';
import type { Item } from '../src/core/items/types';
import { EVENTS, type EventRecord, type ItemRecord, type LogRecord } from '../src/core/log/types';
import { createProfile, type Profile } from '../src/core/profile';
import { toNumber } from '../src/core/rational';
import { createRng } from '../src/core/rng';
import { GRAPH } from '../src/core/skills';
import { dayKey } from '../src/core/time';
import {
  allRects,
  FRAC_BAR_CHECK_ID,
  FRAC_BAR_PROMPT_TYPE,
  fracBarHints,
  fracBarRepr,
  RECT_CHECK_ID,
  RECT_PROMPT_TYPE,
  rectHints,
  rectRepr,
  WORKSHOP_MIS_KEYS,
} from '../src/core/workshop';
import { tk } from '../src/i18n/i18n';
import { allLocales, getLocale } from '../src/i18n/locales';
import { promptText, solutionText, spokenPrompt } from '../src/i18n/render';
import { workshopReady, workshopSkills } from '../src/modes/workshop';
import { getMode, modesFor } from '../src/modes/registry';

const T0 = Date.UTC(2026, 8, 20, 15);
const MK = getLocale('mk').numbers;
const read = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf8');

/** `count` items of a binding, spread over levels, bound like the engine binds them. */
function itemsOf(skillId: string, genId: string, count: number): Item[] {
  const b = GRAPH.get(skillId).gens!.find((g) => g.id === genId)!;
  const gen = getGenerator(genId);
  return Array.from({ length: count }, (_, i) => ({
    ...gen.generate((i % 21) / 20, createRng(31 + i * 7919), b.config ?? {}),
    key: String(i + 1),
    skillId,
    genId,
    genVersion: gen.version,
    seed: i,
  }));
}

const built = (repr: string, data?: Record<string, number>): Response => ({ kind: 'built', value: null, repr, ...(data ? { data } : {}) });
const REVEAL = built('', { reveal: 1 });

describe('workshop: registration', () => {
  it('registers both checkers and all three custom prompts (once, at start-up)', () => {
    expect(hasChecker(FRAC_BAR_CHECK_ID)).toBe(true);
    expect(hasChecker(RECT_CHECK_ID)).toBe(true);
    for (const type of [FRAC_BAR_PROMPT_TYPE, RECT_PROMPT_TYPE, WALK_PROMPT_TYPE]) expect(getCustomPrompt(type), type).toBeDefined();
    const src = read('src/core/items/generators/workshop.ts');
    expect(src.match(/registerChecker\(/g)).toHaveLength(2);
    expect(src.match(/registerCustomPrompt\(/g)).toHaveLength(3);
  });

  it("the Capability union carries exactly one 'build' member (shared with Balance and Coord)", () => {
    const union = read('src/core/items/types.ts').split('export type Capability =')[1]!.split(/\n\s*;\n/)[0]!;
    expect(union.match(/\|\s*'build'/g)).toHaveLength(1);
  });

  it('Workshop generators provide only build; the Hop walk provides a number line without reading', () => {
    for (const id of WORKSHOP_GENERATORS) expect(getGenerator(id).capabilities).toEqual(['build']);
    const walk = getGenerator(PERIMETER_HOPS_GEN).capabilities;
    expect(walk).toContain('numberLine');
    expect(walk).not.toContain('reading');
  });
});

describe('workshop: catalog bindings', () => {
  const genIds = (id: string): string[] => (GRAPH.get(id).gens ?? []).map((g) => g.id);

  it('adds bar bindings to f.unit and f.equiv and makes perimeter and area playable', () => {
    expect(genIds('f.unit')).toEqual(['fracLine', 'fracBar']);
    expect(genIds('f.equiv')).toEqual(['fracLine', 'fracBar']);
    expect(genIds('geo.perimeter')).toEqual(['perimeterHops', 'rectBuild']);
    expect(genIds('geo.area.rect')).toEqual(['rectBuild']);
    for (const id of ['geo.perimeter', 'geo.area.rect']) expect(GRAPH.isPlayable(id), id).toBe(true);
    expect(workshopSkills().map((s) => s.id).sort()).toEqual(['f.equiv', 'f.unit', 'geo.area.rect', 'geo.perimeter']);
  });

  it('geo.perimeter is not a leaf (geo.area.rect waits for it), so Hop serves it too', () => {
    expect(GRAPH.effectivePrereqs('geo.area.rect')).toContain('geo.perimeter');
    // Every playable skill that waits for a Workshop skill waits for one Hop can serve.
    for (const s of GRAPH.playableSkills()) {
      for (const p of GRAPH.effectivePrereqs(s.id)) {
        if (!workshopSkills().some((w) => w.id === p)) continue;
        expect(genIds(p).some((g) => getGenerator(g).capabilities.includes('numberLine')), `${s.id} waits for ${p}`).toBe(true);
      }
    }
  });
});

describe('workshop: items grade constructions, not numbers', () => {
  it('fraction bar: the intended bar and every equivalent one pass; the complement and a reveal fail', () => {
    for (const skill of ['f.unit', 'f.equiv']) {
      for (const it of itemsOf(skill, 'fracBar', 150)) {
        const t = fracBarOf(it)!.target;
        const parts = t.parts ?? t.d;
        const shade = (t.n * parts) / t.d;
        const g = (r: Response) => gradeResponse(it, r, MK);
        expect(g(built(fracBarRepr({ parts, shaded: shade }))).correct, `${skill} ${JSON.stringify(t)}`).toBe(true);
        if (t.parts === undefined && 2 * t.d <= 12) expect(g(built(fracBarRepr({ parts: 2 * t.d, shaded: 2 * t.n }))).correct).toBe(true);
        if (t.parts !== undefined) expect(g(built(fracBarRepr({ parts: t.d, shaded: t.n }))).correct, 'the task fixes the parts').toBe(t.d === t.parts);
        const wrong = g(built(fracBarRepr({ parts, shaded: parts - shade })));
        expect(wrong.correct || wrong.invalid).toBe(parts - shade === shade);
        expect(g(REVEAL)).toMatchObject({ correct: false, invalid: false, given: 'reveal', misconception: null });
      }
    }
  });

  it('rectangle: every valid rectangle passes (both orientations), others fail, a reveal is wrong not invalid', () => {
    for (const skill of ['geo.perimeter', 'geo.area.rect']) {
      for (const it of itemsOf(skill, 'rectBuild', 120)) {
        const c = rectOf(it)!.constraints;
        const ok = new Set(allRects(c).map(rectRepr));
        expect(ok.size, JSON.stringify(c)).toBeGreaterThan(0);
        for (let w = 1; w <= c.maxSide; w++) {
          for (let h = 1; h <= c.maxSide; h++) {
            const r = gradeResponse(it, built(rectRepr({ w, h })), MK);
            expect(r.invalid).toBe(false);
            expect(r.correct, `${JSON.stringify(c)} ${w}x${h}`).toBe(ok.has(`${w}x${h}`));
          }
        }
        expect(gradeResponse(it, REVEAL, MK)).toMatchObject({ correct: false, invalid: false });
        const want = rectOf(it)!.task === 'perimeter' ? c.perimeter : c.area;
        expect(toNumber(it.answer.value)).toBe(want);
      }
    }
  });

  it('names the area/perimeter swap on the rectangle and on the Hop walk', () => {
    const [it] = itemsOf('geo.area.rect', 'rectBuild', 60).filter((x) => {
      const c = rectOf(x)!.constraints;
      return c.perimeter === undefined && c.area! % 2 === 0 && c.area! / 2 - 1 <= c.maxSide;
    });
    const c = rectOf(it!)!.constraints;
    // Perimeter = the asked area: w + h = area / 2.
    const r = gradeResponse(it!, built(rectRepr({ w: 1, h: c.area! / 2 - 1 })), MK);
    expect(r).toMatchObject({ correct: false, misconception: 'workshop.areaPerimeterSwap' });
    for (const walk of itemsOf('geo.perimeter', 'perimeterHops', 60)) {
      const { w, h } = walk.prompt.kind === 'custom' ? (walk.prompt.data as { w: number; h: number }) : { w: 0, h: 0 };
      if (w * h === 2 * (w + h)) continue;
      expect(gradeResponse(walk, { kind: 'typed', raw: String(w * h) }, MK).misconception).toBe(WALK_MISCONCEPTIONS.swap);
      if (w + h !== w * h) expect(gradeResponse(walk, { kind: 'typed', raw: String(w + h) }, MK).misconception).toBe(WALK_MISCONCEPTIONS.half);
      const hops = walk.solution.filter((s) => s.k === 'hop');
      expect(hops.map((s) => (s.k === 'hop' ? s.to - s.from : 0))).toEqual([w, h, w, h]);
    }
  });
});

describe('workshop: the mode', () => {
  const kid = (age: number): Profile => createProfile({ name: 'Лука', age, locale: 'mk', avatar: 'color.green' }, T0);
  const withUnlocked = (p: Profile, ids: string[]): Profile => ({
    ...p,
    placement: { done: true, state: null, g: 4.6, sd: 0.3 },
    skills: Object.fromEntries(ids.map((id) => [id, { ...glickoElo.init(GRAPH.get(id), T0), proficientAt: T0 }])),
  });

  it('is registered at order 50 for Bands B/C, flagged on by default with its own label, evidence 0.75', () => {
    const m = getMode('workshop')!;
    expect(m).toMatchObject({ order: 50, bands: ['B', 'C'], flag: 'mode.workshop', requires: ['build'], titleKey: 'workshop.title' });
    const flag = FLAGS.find((f) => f.id === 'mode.workshop')!;
    expect(flag).toMatchObject({ default: true, scope: 'profile', labelKey: 'workshop.flag' });
    expect(modeEvidence('workshop')).toBe(0.75);
    expect(modesFor(kid(10), {}).map((x) => x.id)).toContain('workshop');
    expect(modesFor(kid(6), {}).map((x) => x.id)).not.toContain('workshop');
    expect(modesFor({ ...kid(10), flags: { 'mode.workshop': false } }, {}).map((x) => x.id)).not.toContain('workshop');
    expect(isEnabled('mode.workshop', {}, {})).toBe(true);
  });

  it('is ready once placement is done and one of its skills is unlocked', () => {
    const p = kid(10);
    expect(workshopReady(p)).toBe(false);
    const unit = GRAPH.effectivePrereqs('f.unit');
    expect(workshopReady(withUnlocked(p, []))).toBe(false);
    expect(workshopReady({ ...withUnlocked(p, unit), placement: { done: false, state: null } })).toBe(false);
    expect(workshopReady(withUnlocked(p, unit))).toBe(true);
  });

  it('serves only its own generators through the shared build capability', () => {
    const m = getMode('workshop')!;
    for (const s of GRAPH.playableSkills()) expect(m.filter!(s, undefined), s.id).toBe(workshopSkills().includes(s));
    expect(m.filter!({ ...GRAPH.get('md.mult.facts'), gens: [{ id: 'equation' }] }, undefined)).toBe(false);
  });
});

describe('workshop: scoring (first check graded, hint tiers, reveal = 0, live = replay)', () => {
  const EN = getLocale('en').numbers;

  function run(respond: (p: PresentedItem, i: number) => Pick<AnswerInput, 'response' | 'hint'> & { hintTier?: number }) {
    let t = T0;
    const engine = new SessionEngine(
      { graph: GRAPH, model: glickoElo, now: () => (t += 5000) },
      { skills: {}, placement: { done: true, state: null } },
      {
        sessionId: 's1', seed: 11, band: { id: 'B', targetP: 0.85, allowReading: true, maxReturns: 3 },
        mode: { id: 'workshop', requires: ['build'], filter: getMode('workshop')!.filter! }, plannedItems: 6, stretch: false, timed: false,
        only: ['geo.area.rect', 'f.unit'],
      },
    );
    const records: ItemRecord[] = [];
    const results = [];
    let p: PresentedItem | null;
    for (let i = 0; i < 20 && (p = engine.next()); i++) {
      const r = engine.answer(p, { ...respond(p, i), latencyMs: 9000, locale: 'en', conv: EN, input: 'tap' });
      results.push(r);
      if (r.record) records.push(r.record);
    }
    return { engine, records, results };
  }

  /** The right construction for an item. */
  const solve = (it: Item): Response => {
    const bar = fracBarOf(it);
    if (bar) {
      const parts = bar.target.parts ?? bar.target.d;
      return built(fracBarRepr({ parts, shaded: (bar.target.n * parts) / bar.target.d }));
    }
    return built(rectRepr(allRects(rectOf(it)!.constraints)[0]!));
  };

  it('logs the hint tier with the first check; replay reproduces the live states at weight 0.75', () => {
    const { engine, records } = run((p, i) => ({ response: i % 3 === 2 ? REVEAL : solve(p.item), hint: i % 3 === 1, hintTier: i % 3 === 1 ? 2 : 0 }));
    expect(records.every((r) => r.mode === 'workshop')).toBe(true);
    expect(records.some((r) => r.tier === 2 && r.correct)).toBe(true);
    const revealed = records.filter((r) => r.answer === 'reveal');
    expect(revealed.length).toBeGreaterThan(0);
    expect(revealed.every((r) => !r.correct)).toBe(true);
    const replayed = replay({ graph: GRAPH, model: glickoElo }, records);
    for (const [id, st] of Object.entries(engine.snapshot.skills)) {
      if (!st.n) continue;
      expect(replayed[id]!.mu, id).toBeCloseTo(st.mu, 3);
      expect(replayed[id]!.s2, id).toBeCloseTo(st.s2, 3);
    }
    expect(hintCredit(2)).toBe(0.5);
  });

  it('a wrong first check (or a reveal) sends the item back later, as in every mode', () => {
    const { results } = run((p) => (p.attempt === 1 ? { response: REVEAL, hint: false } : { response: solve(p.item), hint: false }));
    const first = results.filter((r) => r.presented.attempt === 1);
    expect(first.every((r) => r.willReturn)).toBe(true);
    const back = results.filter((r) => r.presented.attempt === 2);
    expect(back.length).toBe(first.length);
    expect(back.every((r) => r.grade.correct && !r.willReturn)).toBe(true);
  });
});

describe('workshop: strings, Macedonian first', () => {
  const bar = itemsOf('f.equiv', 'fracBar', 40).find((it) => fracBarOf(it)!.target.parts !== undefined)!;
  const unit = itemsOf('f.unit', 'fracBar', 40).find((it) => fracBarOf(it)!.target.n > 1)!;
  const both = itemsOf('geo.area.rect', 'rectBuild', 200).find((it) => rectOf(it)!.task === 'both')!;

  it('renders prompts in mk with the locale conventions', () => {
    const u = fracBarOf(unit)!.target;
    expect(promptText(unit, 'mk', 'B')).toBe(`Обој ${u.n}/${u.d} од лентата.`);
    const b = fracBarOf(bar)!.target;
    expect(promptText(bar, 'mk', 'B')).toBe(`Прикажи ${b.n}/${b.d} со ${b.parts} еднакви дела.`);
    const c = rectOf(both)!.constraints;
    expect(promptText(both, 'mk', 'B')).toBe(`Направи правоаголник со плоштина ${c.area} и периметар ${c.perimeter}.`);
    const walk = itemsOf('geo.perimeter', 'perimeterHops', 1)[0]!;
    const { w, h } = walk.prompt.kind === 'custom' ? (walk.prompt.data as { w: number; h: number }) : { w: 0, h: 0 };
    expect(promptText(walk, 'mk', 'B')).toBe(`Правоаголник има должина ${w} и ширина ${h}. Колку е долг патот околу него?`);
    expect(spokenPrompt(walk, 'mk')).toBe(`Прошетај околу правоаголник ${w} на ${h}!`);
  });

  it('area steps use the locale multiplication sign, and plurals agree in mk', () => {
    const area = { k: 'say' as const, key: 'sol.workshop.rectArea', params: { w: 4, h: 6, area: 24 } };
    expect(solutionText(area, 'mk', 'B')).toBe('Плоштина: 4 · 6 = 24 квадратчиња.');
    expect(solutionText(area, 'en', 'B')).toBe('Area: 4 × 6 = 24 squares.');
    expect(solutionText({ ...area, params: { w: 3, h: 7, area: 21 } }, 'mk', 'B')).toBe('Плоштина: 3 · 7 = 21 квадратче.');
    const others = (count: number): string => tk('mk', 'sol.workshop.rectOthers', { count }, 'B');
    expect(others(1)).toBe('Одговара уште 1 облик.');
    expect(others(3)).toBe('Одговараат уште 3 облици.');
    expect(tk('mk', 'workshop.frac.withParts', { parts: 6 }, 'B')).toBe('Прикажи ја дропката со 6 еднакви дела.');
    expect(getLocale('mk').ops['*']).toBe('·');
  });

  it('every misconception code has a name and a tip in every locale, with a teen tone for the three the board uses', () => {
    const codes = [...Object.keys(WORKSHOP_MIS_KEYS), ...Object.values(WALK_MISCONCEPTIONS)];
    for (const loc of allLocales()) {
      for (const code of codes) {
        expect(loc.messages[`mis.${code}.name`], `${loc.id} ${code}`).toBeTruthy();
        expect(loc.messages[`mis.${code}.tip`], `${loc.id} ${code}`).toBeTruthy();
      }
      for (const code of ['frac.partsVsShaded', 'frac.numeratorKept', 'workshop.areaPerimeterSwap']) {
        expect(loc.messages[`mis.${code}.tip@C`], `${loc.id} ${code}@C`).toBeTruthy();
        expect(tk(loc.id, `mis.${code}.tip`, {}, 'C')).not.toBe(tk(loc.id, `mis.${code}.tip`, {}, 'B'));
      }
    }
  });

  it('hint ladders resolve in every locale; tier 1 never shows a number', () => {
    const ladders = [
      ...itemsOf('f.unit', 'fracBar', 40).map((it) => fracBarHints(fracBarOf(it)!.target)),
      ...itemsOf('f.equiv', 'fracBar', 40).map((it) => fracBarHints(fracBarOf(it)!.target)),
      ...itemsOf('geo.perimeter', 'rectBuild', 40).map((it) => rectHints(rectOf(it)!.constraints)),
      ...itemsOf('geo.area.rect', 'rectBuild', 80).map((it) => rectHints(rectOf(it)!.constraints)),
    ];
    for (const ladder of ladders) {
      expect(ladder.map((h) => h.tier)).toEqual([1, 2, 3]);
      for (const loc of allLocales()) {
        for (const band of ['B', 'C'] as const) {
          for (const h of ladder) {
            const text = tk(loc.id, h.key, h.params, band);
            expect(text, h.key).not.toBe(h.key);
            if (h.tier === 1) expect(/\d/.test(text), text).toBe(false);
          }
        }
      }
    }
  });
});

describe('workshop: exploration achievement', () => {
  const ev = (n: number): EventRecord => ({ type: 'event', ts: T0 + n, sid: 's1', name: EVENTS.WORKSHOP_SHAPE, data: { key: '2', repr: '2x3', n: 2 } });
  const ctx = (p: Profile, log: LogRecord[]): EvalContext => ({ profile: p, now: T0, today: dayKey(T0), log, sessionId: 's1', graph: GRAPH, modesAvailable: 3, memo: new Map() });

  it('Shape Shifter: three extra rectangles found after a solve (exploration, never correctness alone)', () => {
    expect(validateAchievements(ACHIEVEMENTS)).toEqual([]);
    const def = ACHIEVEMENTS.find((a) => a.id === 'workshop.shapes')!;
    expect(def).toMatchObject({ category: 'exploration', bands: ['B', 'C'] });
    const p = createProfile({ name: 'Лука', age: 10, locale: 'mk', avatar: 'color.green' }, T0);
    expect(evaluateAchievements(ACHIEVEMENTS, ctx(p, [ev(1), ev(2)]), 'item')).not.toContain('workshop.shapes');
    expect(evaluateAchievements(ACHIEVEMENTS, ctx(p, [ev(1), ev(2), ev(3)]), 'item')).toContain('workshop.shapes');
  });
});

describe('workshop: generated prompts stay small enough for 360 px', () => {
  it('bars have at most 12 parts and grids at most 12 cells a side', () => {
    for (const it of itemsOf('f.equiv', 'fracBar', 200)) expect(fracBarOf(it)!.target.parts ?? 0).toBeLessThanOrEqual(12);
    for (const it of itemsOf('geo.area.rect', 'rectBuild', 200)) expect(rectOf(it)!.constraints.maxSide).toBeLessThanOrEqual(12);
  });
});
