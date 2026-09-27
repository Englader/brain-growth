import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  evaluateAchievements,
  validateAchievements,
  type AchievementDef,
  type EvalContext,
} from '../src/core/achievements';
import { glickoElo } from '../src/core/engine/glicko';
import { isEnabled, setUrlOverrides } from '../src/core/flags';
import { decodeRivalCard, encodeRivalCard, weeklyEffort, wildcardForWeek, type RivalCard } from '../src/core/league';
import type { ItemRecord, LogRecord, SessionRecord } from '../src/core/log/types';
import { createProfile, type Profile } from '../src/core/profile';
import { questProgress, questsForDay } from '../src/core/quests';
import { dropProbability, pickCosmetic, rollDrop } from '../src/core/rewards/drops';
import { createRng } from '../src/core/rng';
import { GRAPH } from '../src/core/skills';
import { recordActiveDay } from '../src/core/streaks';
import { dayKey, weekKey } from '../src/core/time';

const T = new Date(2026, 8, 16, 16, 0).getTime(); // Wednesday afternoon, local time
const DAY = 86_400_000;

let seq = 0;
function it_(over: Partial<ItemRecord> = {}): ItemRecord {
  seq++;
  return {
    type: 'item', ts: T + seq * 1000, sid: 's1', key: `k${seq}`, skill: 'as.add.20', gen: 'addsub', genV: 1, seed: seq,
    level: 0.5, diff: 0, p: 0.85, mu: 1, s2: 0.4, correct: true, attempt: 1, latency: 3000, hint: false,
    answer: '13', expected: '13', mis: null, mode: 'hop', band: 'B', locale: 'mk', source: 'frontier',
    timed: false, input: 'typed', hops: null, alt: false, ...over,
  };
}
const sess = (over: Partial<SessionRecord>): SessionRecord => ({
  type: 'session', ts: T, sid: 's1', phase: 'end', mode: 'hop', band: 'B', locale: 'mk', opts: {},
  items: 10, firstCorrect: 8, durationMs: 400_000, completed: true, ...over,
});

function ctx(profile: Profile, log: LogRecord[], now = T): EvalContext {
  return { profile, now, today: dayKey(now), log, sessionId: 's1', graph: GRAPH, modesAvailable: 1, memo: new Map() };
}

const kid = (): Profile => createProfile({ name: 'Ана', age: 9, locale: 'mk', avatar: 'color.green' }, T);

describe('achievement catalogue', () => {
  it('passes static validation (no correctness-only rewards, secrets are secret)', () => {
    expect(validateAchievements(ACHIEVEMENTS)).toEqual([]);
  });

  it('the guard rejects an achievement for raw accuracy', () => {
    const bad: AchievementDef = { id: 'bad', category: 'mastery', bands: 'all', icon: 'x', on: ['session'], when: { metric: 'accuracy.session', gte: 0.9 } };
    expect(validateAchievements([bad])[0]).toMatch(/correctness only/);
  });

  it('covers all five categories, with a decent number of secrets', () => {
    const cats = new Set(ACHIEVEMENTS.map((a) => a.category));
    expect(cats).toEqual(new Set(['mastery', 'persistence', 'exploration', 'resilience', 'discovery']));
    expect(ACHIEVEMENTS.filter((a) => a.secret).length).toBeGreaterThanOrEqual(8);
  });
});

describe('achievement evaluation against the log', () => {
  it('resilience: right on the third try after two misses', () => {
    const log = [it_({ key: 'x', correct: false }), it_({ key: 'x', attempt: 2, correct: false }), it_({ key: 'x', attempt: 3, correct: true })];
    const got = evaluateAchievements(ACHIEVEMENTS, ctx(kid(), log), 'item');
    expect(got).toContain('resil.fixOne');
    expect(got).toContain('resil.thirdTry');
    expect(got).not.toContain('resil.fourthTry');
  });

  it('resilience: finishing a session you struggled in', () => {
    const log: LogRecord[] = [
      ...Array.from({ length: 6 }, (_, i) => it_({ correct: i < 2 })),
      sess({ completed: true }),
    ];
    expect(evaluateAchievements(ACHIEVEMENTS, ctx(kid(), log), 'session')).toContain('resil.finishedHard');
  });

  it('persistence: coming back after days away, and the day after a hard session', () => {
    const p = kid();
    const earlier = T - 4 * DAY;
    p.streak = recordActiveDay(recordActiveDay(p.streak, dayKey(earlier)), dayKey(T));
    const log: LogRecord[] = Array.from({ length: 6 }, (_, i) => it_({ sid: 'old', ts: earlier + i, correct: i === 0 }));
    const got = evaluateAchievements(ACHIEVEMENTS, ctx(p, log), 'session');
    expect(got).toContain('persist.comeback');
    expect(got).toContain('persist.dayAfterHard');
  });

  it('exploration: both languages and a mid-session switch', () => {
    const log: LogRecord[] = [
      it_({ locale: 'mk' }),
      it_({ locale: 'en' }),
      { type: 'event', ts: T, sid: 's1', name: 'locale_switch', data: { from: 'mk', to: 'en', mid: true } },
    ];
    const got = evaluateAchievements(ACHIEVEMENTS, ctx(kid(), log), 'item');
    expect(got).toEqual(expect.arrayContaining(['explore.bilingual', 'explore.switchMid']));
  });

  it('exploration: "tried every mode" counts session starts, so standalone modes without items count', () => {
    const start = (sid: string, mode: string): SessionRecord => sess({ sid, mode, phase: 'start', items: null, firstCorrect: null, durationMs: null, completed: null });
    const two = (log: LogRecord[]): EvalContext => ({ ...ctx(kid(), log), modesAvailable: 2 });
    const hopOnly: LogRecord[] = [start('s1', 'hop'), it_({ sid: 's1' })];
    expect(evaluateAchievements(ACHIEVEMENTS, two(hopOnly), 'session')).not.toContain('explore.allModes');
    const withPuzzle: LogRecord[] = [...hopOnly, start('s2', 'puzzle'), sess({ sid: 's2', mode: 'puzzle', items: 0, firstCorrect: 0 })];
    expect(evaluateAchievements(ACHIEVEMENTS, two(withPuzzle), 'session')).toContain('explore.allModes');
  });

  it('mastery is read from the skill graph state, including crossing into the next band', () => {
    const p = kid();
    p.band = 'A';
    p.skills['md.mult.facts'] = { ...glickoElo.init(GRAPH.get('md.mult.facts'), T), masteredAt: T, status: 'mastered' };
    const got = evaluateAchievements(ACHIEVEMENTS, ctx(p, []), 'item');
    expect(got).toEqual(expect.arrayContaining(['mastery.first', 'mastery.bridge']));
    expect(got).not.toContain('mastery.times'); // band B/C only
  });

  it('discovery: a palindrome answer (secret)', () => {
    expect(evaluateAchievements(ACHIEVEMENTS, ctx(kid(), [it_({ answer: '343', expected: '343' })]), 'item')).toContain('secret.palindrome');
  });

  it('never re-awards an unlocked achievement', () => {
    const p = kid();
    p.achievements['resil.fixOne'] = { at: T, seen: true };
    const log = [it_({ key: 'x', attempt: 2, correct: true })];
    expect(evaluateAchievements(ACHIEVEMENTS, ctx(p, log), 'item')).not.toContain('resil.fixOne');
  });
});

describe('surprise drops', () => {
  it('hazard rises with dry spells and is capped', () => {
    expect(dropProbability(0, 'B')).toBeLessThan(dropProbability(10, 'B'));
    expect(dropProbability(1000, 'B')).toBe(0.35);
  });

  it('roughly one drop per Band A session (~9 items), rarer items less often', () => {
    const rng = createRng(1);
    let since = 0;
    let drops = 0;
    const owned: string[] = [];
    for (let i = 0; i < 9000; i++) {
      const r = rollDrop(since, [], 'A', rng);
      since = r.itemsSinceDrop;
      if (r.dropped) {
        drops++;
        owned.push(r.dropped.id);
      }
    }
    const spacing = 9000 / drops;
    expect(spacing).toBeGreaterThan(6);
    expect(spacing).toBeLessThan(11);
    const rare = owned.filter((id) => id === 'color.gold' || id === 'hat.crown' || id === 'pad.star').length;
    expect(rare / owned.length).toBeLessThan(0.15);
  });

  it('never drops a cosmetic from another band and stops when the set is complete', () => {
    const rng = createRng(2);
    const c = pickCosmetic([], 'C', rng)!;
    expect(c.bands).toContain('C');
    expect(['theme', 'title']).toContain(c.slot);
    const everything = ['theme.indigo', 'theme.emerald', 'theme.amber', 'theme.crimson', 'theme.cyan', 'title.estimator', 'title.navigator', 'title.strategist', 'title.analyst', 'title.architect'];
    expect(pickCosmetic(everything, 'C', rng)).toBeNull();
  });
});

describe('daily quests', () => {
  it('are deterministic per child and day, with the right count per band', () => {
    expect(questsForDay('p1', '2026-09-16', 'B')).toEqual(questsForDay('p1', '2026-09-16', 'B'));
    expect(questsForDay('p1', '2026-09-16', 'A')).toHaveLength(2);
    expect(questsForDay('p1', '2026-09-16', 'C')).toHaveLength(3);
    expect(questsForDay('p1', '2026-09-16', 'A')).not.toContain('quest.stretch');
  });

  it('track progress from today’s log only', () => {
    const p = kid();
    const log = [...Array.from({ length: 5 }, () => it_()), it_({ ts: T - 2 * DAY })];
    const q = questProgress('quest.items', ctx(p, log));
    expect(q).toEqual({ value: 5, target: 12, done: false });
  });
});

describe('family league (handicapped by effort and growth, not ability)', () => {
  function weekOf(band: 'A' | 'C', minutesPerDay: number, days: number): LogRecord[] {
    const out: LogRecord[] = [];
    const monday = new Date(2026, 8, 14, 17).getTime();
    for (let d = 0; d < days; d++) {
      const ts = monday + d * DAY;
      for (let i = 0; i < 6; i++) out.push(it_({ ts: ts + i * 1000, sid: `w${d}`, band }));
      out.push(sess({ ts: ts + 10_000, sid: `w${d}`, band, durationMs: minutesPerDay * 60_000 }));
    }
    return out;
  }

  it('a 6-year-old doing 3 min/day ties a 13-year-old doing 12 min/day', () => {
    const wk = weekKey(new Date(2026, 8, 16).getTime());
    const young = weeklyEffort(weekOf('A', 3, 5), wk, 3);
    const teen = weeklyEffort(weekOf('C', 12, 5), wk, 12);
    expect(young.parts.consistency).toBe(teen.parts.consistency);
    expect(young.parts.effort).toBe(teen.parts.effort);
    expect(young.parts.effort).toBe(30);
  });

  it('more minutes than the band target earns nothing extra (no grinding advantage)', () => {
    const wk = weekKey(new Date(2026, 8, 16).getTime());
    expect(weeklyEffort(weekOf('C', 60, 5), wk, 12).parts.effort).toBe(30);
  });

  it('the weekly wildcard is the same on every device (derived from the week id)', () => {
    expect(wildcardForWeek('2026-W38')).toBe(wildcardForWeek('2026-W38'));
  });

  it('rival cards round-trip through a URL fragment and reject tampering', () => {
    const card: RivalCard = {
      v: 1, pid: 'p9', name: 'Стефан', band: 'C', avatar: 'theme.indigo', week: '2026-W38', total: 71,
      parts: { consistency: 28, effort: 24, growth: 10, grit: 9, wildcard: 0 }, streak: 4, updatedAt: T,
    };
    const enc = encodeRivalCard(card);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
    expect(decodeRivalCard(enc)).toEqual(card);
    expect(decodeRivalCard(enc.replace(/\.[0-9a-f]+$/, '.00000000'))).toBeNull();
    expect(decodeRivalCard(enc.slice(0, 20))).toBeNull();
  });
});

describe('feature flags', () => {
  it('precedence: url > profile > device > default', () => {
    setUrlOverrides('');
    expect(isEnabled('mode.sprint', {}, {})).toBe(true); // features ship on (DESIGN A-26)
    expect(isEnabled('mode.sprint', { 'mode.sprint': false }, {})).toBe(false);
    expect(isEnabled('mode.sprint', {}, { 'mode.sprint': false })).toBe(false);
    expect(isEnabled('mode.sprint', { 'mode.sprint': true }, { 'mode.sprint': false })).toBe(true);
    expect(isEnabled('league.family', {}, { 'league.family': false })).toBe(false);
    setUrlOverrides('?ff=-mode.sprint');
    expect(isEnabled('mode.sprint', { 'mode.sprint': true }, {})).toBe(false);
    setUrlOverrides('?ff=debug.shortSessions');
    expect(isEnabled('debug.shortSessions', {}, { 'debug.shortSessions': false })).toBe(true);
    setUrlOverrides('');
    expect(isEnabled('no.such.flag', {}, {})).toBe(false);
  });
});
