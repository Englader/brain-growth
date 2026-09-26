import { describe, expect, it } from 'vitest';
import { glickoElo, levelToDifficulty } from '../src/core/engine/glicko';
import { daysUntilDue, isDue, memoryEvent, retrievability, startMemory } from '../src/core/engine/memory';
import type { SkillState } from '../src/core/engine/model';
import { MEMORY } from '../src/core/engine/params';
import { replay } from '../src/core/engine/replay';
import { startPlacement } from '../src/core/engine/placement';
import { chooseSkill } from '../src/core/engine/scheduler';
import { SessionEngine, type LearnerSnapshot } from '../src/core/engine/session';
import type { LogRecord } from '../src/core/log/types';
import { key } from '../src/core/rational';
import { createRng } from '../src/core/rng';
import { GRAPH } from '../src/core/skills';
import { DAY_MS } from '../src/core/time';
import { EN_CONV, SimClock } from '../sim/harness';

const skill = GRAPH.get('as.add.20');
const T0 = Date.UTC(2026, 8, 1, 12);

describe('Glicko-Elo learner model', () => {
  const fresh = (): SkillState => glickoElo.init(skill, T0);

  it('moves up on success, down on failure, and shrinks uncertainty', () => {
    const s = fresh();
    const d = levelToDifficulty(0.3);
    const up = glickoElo.update(s, { y: 1, difficulty: d, ts: T0 + 1000, weight: 1 });
    const down = glickoElo.update(s, { y: 0, difficulty: d, ts: T0 + 1000, weight: 1 });
    expect(up.mu).toBeGreaterThan(s.mu);
    expect(down.mu).toBeLessThan(s.mu);
    expect(up.s2).toBeLessThan(s.s2);
    expect(down.mu - s.mu).toBeLessThan(-(up.mu - s.mu)); // a surprise failure moves more than an expected success
  });

  it('gain K shrinks with evidence but stays > 0.2 (it keeps tracking a learning child)', () => {
    let s = fresh();
    for (let i = 0; i < 200; i++) s = glickoElo.update(s, { y: i % 7 ? 1 : 0, difficulty: s.mu - 1.7, ts: T0 + i * 1000, weight: 1 });
    expect(s.s2).toBeGreaterThan(0.2);
    expect(s.s2).toBeLessThan(0.8);
  });

  it('difficultyFor is the inverse of predict', () => {
    const s = { ...fresh(), mu: 0.7, s2: 0.6 };
    for (const p of [0.7, 0.85, 0.95]) {
      const d = glickoElo.difficultyFor(s, p, T0);
      expect(glickoElo.predict(s, d, T0)).toBeCloseTo(p, 6);
    }
  });

  it('weight 0 (timed) leaves ability untouched', () => {
    const s = fresh();
    const t = glickoElo.update(s, { y: 0, difficulty: 0, ts: T0, weight: 0 });
    expect(t.mu).toBe(s.mu);
    expect(t.s2).toBe(s.s2);
  });

  it('requires evidence before "mastered": a high rating alone is not enough', () => {
    const lucky = { ...fresh(), mu: 5, s2: 0.1, n: 3, recent: 0b111, recentN: 3 };
    expect(glickoElo.status(lucky, skill, true, T0)).not.toBe('mastered');
    const earned = { ...lucky, n: 12, recent: 0b11111110, recentN: 8 };
    expect(glickoElo.status(earned, skill, true, T0)).toBe('mastered');
  });

  it('status is locked only when prerequisites are not met and nothing was ever shown', () => {
    expect(glickoElo.status(undefined, skill, false, T0)).toBe('locked');
    expect(glickoElo.status(undefined, skill, true, T0)).toBe('available');
  });
});

describe('spaced retrieval memory', () => {
  const base = startMemory({ ...glickoElo.init(skill, T0), proficientAt: T0 }, T0);

  it('recall decays with a half-life', () => {
    expect(retrievability(base, T0)).toBe(1);
    expect(retrievability(base, T0 + MEMORY.H0_DAYS * DAY_MS)).toBeCloseTo(0.5, 6);
  });

  it('becomes due when R < 0.8 (≈0.64 days after proficiency)', () => {
    expect(isDue(base, T0 + 0.5 * DAY_MS)).toBe(false);
    expect(isDue(base, T0 + 0.7 * DAY_MS)).toBe(true);
    expect(daysUntilDue(base, T0)).toBeCloseTo(MEMORY.H0_DAYS * Math.log2(1 / 0.8), 6);
  });

  it('successful spaced reviews expand the interval; a lapse halves it', () => {
    let s = base;
    let t = T0;
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      const wait = daysUntilDue(s, t)! + 0.01;
      gaps.push(wait);
      t += wait * DAY_MS;
      s = memoryEvent(s, true, t).state;
    }
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]! * 1.5);
    const lapse = memoryEvent(s, false, t + daysUntilDue(s, t)! * DAY_MS + DAY_MS);
    expect(lapse.state.h).toBeCloseTo(s.h! * MEMORY.LAPSE, 6);
  });

  it('massed practice within 12 h does not count as a memory event', () => {
    const r = memoryEvent(base, true, T0 + 2 * 3_600_000);
    expect(r.counted).toBe(false);
    expect(r.state.h).toBe(base.h);
  });
});

describe('scheduler', () => {
  it('interleaves: never the same skill three times in a row', () => {
    const rng = createRng(3);
    const states: Record<string, SkillState> = {};
    for (const id of ['as.add.10', 'as.sub.10', 'as.bonds.5']) {
      states[id] = { ...glickoElo.init(GRAPH.get(id), T0), n: 3, status: 'learning' };
    }
    const history: string[] = [];
    for (let i = 0; i < 60; i++) {
      const c = chooseSkill({
        graph: GRAPH, model: glickoElo, states, now: T0, rng,
        eligibility: { requires: ['numberLine'], allowReading: true },
        history, newIntroduced: 2,
      });
      expect(c).not.toBeNull();
      history.push(c!.skillId);
      if (history.length >= 3) {
        const [a, b, d] = history.slice(-3);
        expect(a === b && b === d).toBe(false);
      }
    }
  });

  it('includes due reviews', () => {
    const rng = createRng(4);
    const due = startMemory({ ...glickoElo.init(GRAPH.get('as.add.10'), T0), n: 20, mu: 3, s2: 0.2, proficientAt: T0, status: 'proficient' as const }, T0);
    const states = { 'as.add.10': due };
    const sources = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const c = chooseSkill({
        graph: GRAPH, model: glickoElo, states, now: T0 + 3 * DAY_MS, rng,
        eligibility: { requires: ['numberLine'], allowReading: true }, history: ['x'], newIntroduced: 0,
      });
      if (c) sources.add(c.source);
    }
    expect(sources.has('review')).toBe(true);
    expect(sources.has('frontier')).toBe(true);
  });
});

describe('placement never turns into babyish review', () => {
  it('skills far below a teen are not due for weeks, and the Band C review floor excludes them', () => {
    const clock = new SimClock(T0);
    const e = new SessionEngine({ graph: GRAPH, model: glickoElo, now: clock.now }, { skills: {}, placement: { done: false, state: startPlacement(13) } }, {
      sessionId: 'teen', seed: 7, band: { id: 'C', targetP: 0.82, allowReading: true, maxReturns: 3, reviewFloor: 3 },
      mode: { id: 'hop', requires: ['numberLine'] }, plannedItems: 40, stretch: false, timed: false,
    });
    const seen: string[] = [];
    for (let p = e.next(); p; p = e.next()) {
      seen.push(p.item.skillId);
      clock.advance(4000);
      e.answer(p, { response: { kind: 'typed', raw: key(p.item.answer.value) }, latencyMs: 3000, hint: false, locale: 'en', conv: EN_CONV, input: 'typed' });
    }
    const count = e.snapshot.skills['num.count.10']!;
    expect(count.proficientAt).toBeDefined();
    expect(count.h!).toBeGreaterThan(30);
    // Nothing from preschool/grade-1 content was served to the 13-year-old after placement.
    const afterPlacement = seen.slice(8);
    expect(afterPlacement.filter((id) => GRAPH.get(id).grade < 3)).toEqual([]);
  });
});

function engineFor(snapshot: LearnerSnapshot, clock: SimClock, opts: Partial<{ timed: boolean; items: number; maxReturns: number }> = {}): SessionEngine {
  return new SessionEngine({ graph: GRAPH, model: glickoElo, now: clock.now }, snapshot, {
    sessionId: 's1',
    seed: 99,
    band: { id: 'B', targetP: 0.85, allowReading: true, maxReturns: opts.maxReturns ?? 2 },
    mode: { id: 'hop', requires: ['numberLine'] },
    plannedItems: opts.items ?? 10,
    stretch: false,
    timed: opts.timed ?? false,
  });
}

describe('SessionEngine', () => {
  const noPlacement: LearnerSnapshot = { skills: {}, placement: { done: true, state: null } };

  it('a wrong answer returns the same item a few items later, as attempt 2', () => {
    const clock = new SimClock();
    const e = engineFor(noPlacement, clock);
    const first = e.next()!;
    const r = e.answer(first, { response: { kind: 'typed', raw: '-12345' }, latencyMs: 3000, hint: false, locale: 'en', conv: EN_CONV, input: 'typed' });
    expect(r.grade.correct).toBe(false);
    expect(r.willReturn).toBe(true);
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = e.next()!;
      seen.push(`${p.item.key}#${p.attempt}`);
      e.answer(p, { response: { kind: 'typed', raw: key(p.item.answer.value) }, latencyMs: 2000, hint: false, locale: 'en', conv: EN_CONV, input: 'typed' });
    }
    expect(seen.indexOf(`${first.item.key}#2`)).toBe(3);
  });

  it('invalid input is not an attempt and changes nothing', () => {
    const clock = new SimClock();
    const e = engineFor(noPlacement, clock);
    const p = e.next()!;
    const before = JSON.stringify(e.snapshot);
    const r = e.answer(p, { response: { kind: 'typed', raw: '1..2' }, latencyMs: 1000, hint: false, locale: 'en', conv: EN_CONV, input: 'typed' });
    expect(r.grade.invalid).toBe(true);
    expect(r.record).toBeNull();
    expect(JSON.stringify(e.snapshot)).toBe(before);
    expect(e.stats.answered).toBe(0);
  });

  it('replaying the log reproduces live learner state', () => {
    const clock = new SimClock(T0);
    const rng = createRng(5);
    let snap = noPlacement;
    const log: LogRecord[] = [];
    for (let day = 0; day < 5; day++) {
      const e = engineFor(snap, clock, { items: 12 });
      for (let p = e.next(); p; p = e.next()) {
        clock.advance(5000);
        const right = rng.chance(0.8);
        const r = e.answer(p, {
          response: { kind: 'typed', raw: right ? key(p.item.answer.value) : '99999' },
          latencyMs: 4000, hint: false, locale: 'en', conv: EN_CONV, input: 'typed',
        });
        if (r.record) log.push(r.record);
      }
      snap = e.snapshot;
      clock.advance(DAY_MS);
    }
    const rebuilt = replay({ graph: GRAPH, model: glickoElo }, log);
    for (const [id, st] of Object.entries(snap.skills)) {
      if (!st.n) continue;
      expect(rebuilt[id]!.n).toBe(st.n);
      expect(rebuilt[id]!.mu).toBeCloseTo(st.mu, 2);
      expect(rebuilt[id]!.status).toBe(st.status);
    }
  });

  it('timed sessions record observations but do not move ability', () => {
    const clock = new SimClock();
    const warm: LearnerSnapshot = { skills: { 'as.add.10': { ...glickoElo.init(GRAPH.get('as.add.10'), clock.t), n: 10, status: 'proficient', proficientAt: clock.t } }, placement: { done: true, state: null } };
    const e = new SessionEngine({ graph: GRAPH, model: glickoElo, now: clock.now }, warm, {
      sessionId: 't', seed: 1, band: { id: 'B', targetP: 0.85, allowReading: true, maxReturns: 0 },
      mode: { id: 'sprint', requires: ['numberLine'], filter: (s) => s.id === 'as.add.10' },
      plannedItems: 3, stretch: false, timed: true,
    });
    for (let p = e.next(); p; p = e.next()) {
      const r = e.answer(p, { response: { kind: 'typed', raw: '77777' }, latencyMs: 900, hint: false, locale: 'en', conv: EN_CONV, input: 'typed' });
      expect(r.record!.timed).toBe(true);
    }
    expect(e.snapshot.skills['as.add.10']!.mu).toBe(warm.skills['as.add.10']!.mu);
  });
});
