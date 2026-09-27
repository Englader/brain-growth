/**
 * The Wave 0 seams that parallel features build on: checker and custom-prompt
 * registries, the 'built' response, per-mode evidence weight (live = replay),
 * profile-parameterised session actions, and the mode registry.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import '../src/modes';
import { finishSession, launchMode, recordAnswer, startSessionFor } from '../src/app/actions';
import { recentLog, saveProfile } from '../src/app/persist';
import { repo } from '../src/app/services';
import { getState, setState } from '../src/app/store';
import { glickoElo } from '../src/core/engine/glicko';
import { MODE_EVIDENCE, modeEvidence } from '../src/core/engine/params';
import { replay } from '../src/core/engine/replay';
import { SessionEngine, type PresentedItem } from '../src/core/engine/session';
import { registerChecker } from '../src/core/items/checkers';
import { registerCustomPrompt } from '../src/core/items/customPrompts';
import { gradeResponse } from '../src/core/items/grade';
import type { Item } from '../src/core/items/types';
import type { ItemRecord } from '../src/core/log/types';
import { createProfile, type Profile } from '../src/core/profile';
import { key, rat, toNumber } from '../src/core/rational';
import { GRAPH } from '../src/core/skills';
import { tk } from '../src/i18n/i18n';
import { getLocale } from '../src/i18n/locales';
import { customVoice, promptText, spokenPrompt } from '../src/i18n/render';
import { allModes, getMode, modesFor } from '../src/modes/registry';
import type { ModeDef } from '../src/modes/types';

const EN = getLocale('en').numbers;
const T0 = Date.UTC(2026, 8, 20, 15);

function item(over: Partial<Item> = {}): Item {
  return {
    key: '1', skillId: 'as.add.20', genId: 'test', genVersion: 1, seed: 1, level: 0.5,
    prompt: { kind: 'custom', type: 'test.deal', data: { cards: [3, 4, 6], target: 10 } },
    answer: { value: rat(10) },
    line: { min: 0, max: 20, start: 0, major: 5, minor: 1, labelEvery: 5, steps: [1], answerMode: 'land' },
    solution: [], misconceptions: [{ value: 13, code: 'test.addedAll' }], features: {},
    ...over,
  };
}

// ── grading ─────────────────────────────────────────────────────────────────
describe('checker registry', () => {
  // "Make the target from the cards": accepts any expression over distinct cards; re-parses repr, never trusts value.
  registerChecker('test.sum', (it, r, params) => {
    if (r.kind !== 'built') return { correct: false, invalid: true, given: '' };
    const used = r.repr.split('+').map(Number);
    if (used.some((n) => !Number.isFinite(n))) return { correct: false, invalid: true, given: r.repr };
    const total = used.reduce((a, b) => a + b, 0);
    const target = toNumber(it.answer.value) + (params.offset ?? 0);
    return { correct: total === target, given: r.repr, misconception: total === 13 ? 'test.addedAll' : null, delta: total - target };
  });
  const checked = item({ answer: { value: rat(10), check: { id: 'test.sum' } } });

  it('delegates grading to the registered checker', () => {
    expect(gradeResponse(checked, { kind: 'built', value: null, repr: '4+6' }, EN)).toMatchObject({ correct: true, invalid: false, given: '4+6' });
    expect(gradeResponse(checked, { kind: 'built', value: rat(10), repr: '3+4+6' }, EN)).toMatchObject({ correct: false, given: '3+4+6', misconception: 'test.addedAll', delta: 3 });
    expect(gradeResponse(checked, { kind: 'built', value: null, repr: 'x+1' }, EN)).toMatchObject({ correct: false, invalid: true, misconception: null });
  });

  it('passes check params, and a correct answer never carries a misconception', () => {
    const shifted = item({ answer: { value: rat(10), check: { id: 'test.sum', params: { offset: 3 } } } });
    expect(gradeResponse(shifted, { kind: 'built', value: null, repr: '3+4+6' }, EN)).toMatchObject({ correct: true, misconception: null });
  });

  it('rejects duplicates and unknown ids loudly', () => {
    expect(() => registerChecker('test.sum', () => ({ correct: true, given: '' }))).toThrow(/twice/);
    expect(() => gradeResponse(item({ answer: { value: rat(1), check: { id: 'nope' } } }), { kind: 'typed', raw: '1' }, EN)).toThrow(/unknown checker/);
  });

  it("grades a 'built' response by value when the item has no checker", () => {
    const plain = item();
    expect(gradeResponse(plain, { kind: 'built', value: rat(10), repr: '4+6' }, EN)).toMatchObject({ correct: true, given: key(rat(10)) });
    expect(gradeResponse(plain, { kind: 'built', value: rat(13), repr: '3+4+6' }, EN)).toMatchObject({ correct: false, misconception: 'test.addedAll' });
    expect(gradeResponse(plain, { kind: 'built', value: null, repr: '' }, EN)).toMatchObject({ invalid: true });
  });
});

describe('custom-prompt registry', () => {
  registerCustomPrompt('test.deal', {
    text: (p, _it, locale, band) => `${locale}/${band}: make ${String(p.data.target)}`,
    spoken: (p) => ({ key: 'voice.locate', params: { n: Number(p.data.target) } }),
  });

  it('renders registered prompts through their definition', () => {
    const it0 = item();
    expect(promptText(it0, 'mk', 'B')).toBe('mk/B: make 10');
    expect(customVoice(it0)).toEqual({ key: 'voice.locate', params: { n: 10 } });
    expect(spokenPrompt(it0, 'en')).toBe(tk('en', 'voice.locate', { n: 10 }));
  });

  it('falls back safely for an unregistered type (generic instruction, silence)', () => {
    const it0 = item({ prompt: { kind: 'custom', type: 'test.missing', data: {} } });
    expect(promptText(it0, 'en', 'B')).toBe(getLocale('en').messages['prompt.custom']);
    expect(promptText(it0, 'mk', 'C')).toBe(getLocale('mk').messages['prompt.custom']);
    expect(spokenPrompt(it0, 'mk')).toBe('');
    expect(customVoice(it0)).toBeNull();
  });
});

// ── evidence weight ─────────────────────────────────────────────────────────
describe('per-mode evidence weight', () => {
  beforeAll(() => {
    MODE_EVIDENCE.target = 0.5;
  });
  afterAll(() => {
    delete MODE_EVIDENCE.target;
  });

  function liveSession(modeId: string): { records: ItemRecord[]; engine: SessionEngine } {
    let t = T0;
    const engine = new SessionEngine(
      { graph: GRAPH, model: glickoElo, now: () => (t += 4000) },
      { skills: {}, placement: { done: true, state: null } },
      {
        sessionId: 's1', seed: 7, band: { id: 'B', targetP: 0.85, allowReading: false, maxReturns: 1 },
        mode: { id: modeId, requires: ['numberLine'] }, plannedItems: 6, stretch: false, timed: false,
      },
    );
    const records: ItemRecord[] = [];
    let p: PresentedItem | null;
    for (let i = 0; (p = engine.next()); i++) {
      const ans = toNumber(p.item.answer.value);
      const raw = String(i % 3 === 1 ? ans + 1 : ans);
      const r = engine.answer(p, { response: { kind: 'typed', raw }, latencyMs: 3000, hint: false, locale: 'en', conv: EN, input: 'typed' });
      if (r.record) records.push(r.record);
    }
    return { records, engine };
  }

  // Records store difficulty to 3 decimals, so replay matches live to that precision.
  it('live sessions and log replay apply the same weight (synthetic mode "target" at 0.5)', () => {
    expect(modeEvidence('target')).toBe(0.5);
    expect(modeEvidence('hop')).toBe(1);
    const { records, engine } = liveSession('target');
    expect(records.length).toBeGreaterThanOrEqual(6);
    expect(records.every((r) => r.mode === 'target')).toBe(true);
    const replayed = replay({ graph: GRAPH, model: glickoElo }, records);
    for (const [id, st] of Object.entries(engine.snapshot.skills)) {
      if (!st.n) continue;
      expect(replayed[id]!.mu, id).toBeCloseTo(st.mu, 3);
      expect(replayed[id]!.s2, id).toBeCloseTo(st.s2, 3);
    }
  });

  it('the weight changes the update (the parity above is not vacuous)', () => {
    const { records } = liveSession('target');
    const asTarget = replay({ graph: GRAPH, model: glickoElo }, records);
    const asHop = replay({ graph: GRAPH, model: glickoElo }, records.map((r) => ({ ...r, mode: 'hop' })));
    const moved = Object.keys(asTarget).filter((id) => asTarget[id]!.n && Math.abs(asTarget[id]!.mu - asHop[id]!.mu) > 0.01);
    expect(moved.length).toBeGreaterThan(0);
  });
});

// ── profile-parameterised actions ───────────────────────────────────────────
describe('session actions for a profile that is not the active one', () => {
  const kid = (name: string, age: number): Profile => saveProfile(createProfile({ name, age, locale: 'mk', avatar: 'color.green' }, Date.now()));

  it('recordAnswer and finishSession write only that profile, and leave the store session alone', () => {
    repo.init();
    const ana = kid('Ана', 6);
    const marko = kid('Марко', 9);
    setState({ profile: ana, profiles: [ana, marko], session: null, meta: repo.meta() });
    const anaLog = repo.readKnownLog(ana.id).length;

    let s = startSessionFor(marko, 'hop')!;
    expect(s.pid).toBe(marko.id);
    let p = marko;
    for (let i = 0; i < 3; i++) {
      const presented = s.engine.next()!;
      const r = recordAnswer(p, s, presented, { kind: 'typed', raw: key(presented.item.answer.value) }, { latencyMs: 2500, hint: false, input: 'typed', hops: 0 });
      expect(r.res.grade.correct).toBe(true);
      p = r.profile;
      s = r.session;
    }
    const done = finishSession(p, s, true);

    expect(done.result.firstAttempts).toBe(3);
    expect(done.profile.stats.items).toBe(3);
    expect(repo.loadProfile(marko.id)!.stats.items).toBe(3);
    const markoLog = repo.readKnownLog(marko.id);
    expect(markoLog.filter((r) => r.type === 'item')).toHaveLength(3);
    expect(markoLog.filter((r) => r.type === 'session').map((r) => r.type === 'session' && r.phase)).toEqual(['start', 'end']);
    expect(recentLog(marko.id)).toHaveLength(markoLog.length);
    // Ana: untouched on disk, still the active profile, no store session created.
    expect(repo.readKnownLog(ana.id)).toHaveLength(anaLog);
    expect(repo.loadProfile(ana.id)!.stats.items).toBe(0);
    expect(getState().profile?.id).toBe(ana.id);
    expect(getState().session).toBeNull();
    expect(getState().profiles.find((x) => x.id === marko.id)!.stats.items).toBe(3);
  });

  it('only placement modes serve placement items; other modes keep the profile placement untouched', () => {
    const p = kid('Стефан', 13);
    const hop = startSessionFor(p, 'hop')!;
    expect(hop.engine.placementRunning).toBe(true);
    const sprint = startSessionFor(p, 'sprint')!;
    expect(sprint.engine.placementRunning).toBe(false);
  });
});

// ── mode registry ───────────────────────────────────────────────────────────
describe('mode registry', () => {
  it('lists modes by order; Hop alone runs placement; Sprint opens its intro', () => {
    const ids = allModes().map((m) => m.id);
    expect(ids.slice(0, 2)).toEqual(['hop', 'sprint']);
    expect(allModes().filter((m) => m.placement).map((m) => m.id)).toEqual(['hop']);
    expect(getMode('sprint')!.intro).toBeDefined();
  });

  it('Sprint is on by default for Bands B/C (DESIGN A-26) and never offered in Band A', () => {
    const b = createProfile({ name: 'B', age: 9, locale: 'mk', avatar: 'color.green' }, T0);
    const a = createProfile({ name: 'A', age: 6, locale: 'mk', avatar: 'color.green' }, T0);
    expect(modesFor(b, {}).map((m) => m.id)).toContain('sprint');
    expect(modesFor({ ...b, flags: { 'mode.sprint': false } }, {}).map((m) => m.id)).not.toContain('sprint');
    expect(modesFor(a, {}).map((m) => m.id)).not.toContain('sprint');
  });

  it('launchMode prefers the mode’s own launch, then its intro route, then a session', () => {
    const launch = vi.fn();
    const base: ModeDef = { ...getMode('hop')!, id: 'x' };
    launchMode({ ...base, launch }, { quick: true });
    expect(launch).toHaveBeenCalledWith({ quick: true });

    const hist = { pushState: vi.fn(), replaceState: vi.fn() };
    vi.stubGlobal('history', hist);
    vi.stubGlobal('location', { hash: '' });
    launchMode({ ...base, intro: () => null }, {}, true);
    expect(hist.replaceState).toHaveBeenCalledWith(null, '', '#/intro/x');
    expect(getState().route).toBe('/intro/x');
    vi.unstubAllGlobals();
  });
});
