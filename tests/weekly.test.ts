import { describe, expect, it } from 'vitest';
import type { ItemRecord, LogRecord, SessionRecord } from '../src/core/log/types';
import { COSMETICS } from '../src/core/rewards/cosmetics';
import { SKILLS } from '../src/core/skills/catalog';
import { weekKey } from '../src/core/time';
import type { BandId } from '../src/core/types';
import * as weekly from '../src/core/weekly';
import {
  boostedWeight,
  getWeeklyTheme,
  isThemeSkill,
  MIXED_THEME,
  mergeWeekly,
  rewardFor,
  themeBoost,
  themeFor,
  WEEKLY_BOOST,
  WEEKLY_COSMETICS,
  WEEKLY_KEYS,
  WEEKLY_THEMES,
  weeklyProgress,
  weeklyReward,
  weeklyThemeDescKey,
  weeklyThemeNameKey,
  type WeeklyState,
  type WeeklyTheme,
} from '../src/core/weekly';

const PLAYABLE = SKILLS.filter((s) => s.gens?.length).map((s) => s.id);
const BANDS: BandId[] = ['A', 'B', 'C'];

// Monday 2026-09-28 … Sunday 2026-10-04 is ISO week 2026-W40 (local time).
const day = (d: number, h = 17): number => new Date(2026, 8, 28 + d, h, 0, 0).getTime();
const WEEK = weekKey(day(0));

function item(sid: string, key: string, skill: string, ts: number, over: Partial<ItemRecord> = {}): ItemRecord {
  return {
    type: 'item', ts, sid, key, skill, gen: 'addsub', genV: 1, seed: 1, level: 0.3, diff: 0, p: 0.7, mu: 0, s2: 1,
    correct: true, attempt: 1, latency: 3000, hint: false, answer: '1', expected: '1', mis: null, mode: 'hop',
    band: 'A', locale: 'mk', source: 'frontier', timed: false, input: 'tap', hops: null, alt: false, ...over,
  };
}

function session(sid: string, ts: number, phase: 'start' | 'end', completed = true, quick = false): SessionRecord {
  return {
    type: 'session', ts, sid, phase, mode: 'hop', band: 'A', locale: 'mk', opts: quick ? { quick: true } : {},
    items: phase === 'end' ? 5 : null, firstCorrect: phase === 'end' ? 4 : null,
    durationMs: phase === 'end' ? 180_000 : null, completed: phase === 'end' ? completed : null,
  };
}

/** A session on day `d` with the given first-attempt skills. */
function play(sid: string, d: number, skills: string[], opts: { completed?: boolean; quick?: boolean } = {}): LogRecord[] {
  const t0 = day(d);
  return [
    session(sid, t0, 'start', true, opts.quick),
    ...skills.map((s, i) => item(sid, `${sid}.${i}`, s, t0 + 1000 * (i + 1), { correct: i % 2 === 0 })),
    session(sid, t0 + 60_000, 'end', opts.completed ?? true, opts.quick),
  ];
}

const bridge = getWeeklyTheme('bridgeTen')!;
const THREE = ['as.add.20', 'as.sub.20', 'as.add.20'];

describe('weekly themes (data)', () => {
  it('has 6–10 themes plus the mixed fallback, with unique ids', () => {
    expect(WEEKLY_THEMES.length).toBeGreaterThanOrEqual(6);
    expect(WEEKLY_THEMES.length).toBeLessThanOrEqual(10);
    const ids = [...WEEKLY_THEMES.map((t) => t.id), MIXED_THEME.id];
    expect(new Set(ids).size).toBe(ids.length);
    expect(MIXED_THEME.skills).toEqual([]);
  });

  it('uses only real, playable skills and covers every band', () => {
    for (const t of WEEKLY_THEMES) {
      expect(t.skills.length).toBeGreaterThan(0);
      for (const s of t.skills) expect(PLAYABLE, `${t.id}: ${s}`).toContain(s);
    }
    for (const b of BANDS) expect(WEEKLY_THEMES.filter((t) => t.bands.includes(b)).length).toBeGreaterThanOrEqual(4);
  });

  it('rewards a weekly.* set piece in exactly the bands the theme runs in', () => {
    const defs = new Map(WEEKLY_COSMETICS.map((c) => [c.id, c]));
    for (const t of [...WEEKLY_THEMES, MIXED_THEME]) {
      expect(Object.keys(t.reward).sort()).toEqual([...t.bands].sort());
      for (const b of t.bands) {
        const id = rewardFor(t, b)!;
        expect(id).toMatch(/^weekly\./);
        expect(defs.get(id)?.bands, `${t.id}/${b}`).toContain(b);
      }
    }
  });

  it('set pieces are well-formed, never collide with drop cosmetics, and are not in the drop pool', () => {
    const ids = WEEKLY_COSMETICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const used = new Set([...WEEKLY_THEMES, MIXED_THEME].flatMap((t) => Object.values(t.reward)));
    for (const c of WEEKLY_COSMETICS) {
      expect(c.source).toBe('weekly');
      expect(used.has(c.id), `unused set piece ${c.id}`).toBe(true);
      expect(['pad', 'color', 'theme']).toContain(c.slot);
      expect(c.bands).toEqual(c.slot === 'theme' ? ['C'] : ['A', 'B']);
      expect(c.value).toMatch(/^#[0-9a-f]{6}$/);
      expect(COSMETICS.some((d) => d.id === c.id)).toBe(false);
    }
  });
});

describe('themeFor', () => {
  it('is deterministic and shared by siblings in the same band', () => {
    for (let w = 1; w <= 52; w++) {
      const week = `2026-W${String(w).padStart(2, '0')}`;
      for (const b of BANDS) {
        const ana = themeFor(week, b, PLAYABLE);
        const marko = themeFor(week, b, [...PLAYABLE].reverse());
        expect(marko.id).toBe(ana.id);
        expect(themeFor(week, b, PLAYABLE)).toBe(ana);
      }
    }
  });

  it('siblings agree whenever the top-ranked theme is open to both', () => {
    for (let w = 1; w <= 52; w++) {
      const week = `2027-W${String(w).padStart(2, '0')}`;
      const full = themeFor(week, 'B', PLAYABLE);
      const partial = themeFor(week, 'B', full.skills.slice(0, 1)); // a sibling with just one of its skills open
      expect(partial.id).toBe(full.id);
    }
  });

  it('rotates through several themes over a year', () => {
    for (const b of BANDS) {
      const seen = new Set(Array.from({ length: 52 }, (_, i) => themeFor(`2026-W${String(i + 1).padStart(2, '0')}`, b, PLAYABLE).id));
      expect(seen.size, b).toBeGreaterThanOrEqual(4);
    }
  });

  it('only picks a theme for the band with at least one unlocked skill', () => {
    for (let w = 1; w <= 52; w++) {
      const week = `2026-W${String(w).padStart(2, '0')}`;
      for (const b of BANDS) {
        const open = ['as.add.20', 'md.mult.facts', 'int.addsub'];
        const t = themeFor(week, b, open);
        if (t.id === MIXED_THEME.id) continue;
        expect(t.bands).toContain(b);
        expect(t.skills.some((s) => open.includes(s))).toBe(true);
      }
    }
  });

  it('falls back to the mixed theme when nothing is unlocked', () => {
    expect(themeFor('2026-W40', 'A', [])).toBe(MIXED_THEME);
    expect(themeFor('2026-W40', 'C', ['geo.shapes.basic', 'num.subitize.5'])).toBe(MIXED_THEME);
    expect(themeFor('2026-W40', 'A', new Set(['num.count.10'])).id).toBe('counting');
  });
});

describe('weeklyProgress', () => {
  it('counts completed sessions with at least 3 theme first attempts, right or wrong', () => {
    const log = [0, 1, 2, 3, 4].flatMap((d) => play(`s${d}`, d, THREE));
    expect(weeklyProgress(log, WEEK, bridge)).toEqual({ week: WEEK, theme: 'bridgeTen', sessions: 5, target: 5, complete: true });
    expect(weeklyProgress(log.slice(0, 15), WEEK, bridge).sessions).toBe(3);
  });

  it('does not count short, off-theme, retried, unfinished or other-week sessions', () => {
    const log = [
      ...play('short', 0, ['as.add.20', 'as.sub.20']),
      ...play('offTheme', 1, ['as.add.20', 'as.sub.20', 'num.count.10', 'num.count.10']),
      ...play('unfinished', 2, THREE, { completed: false }),
      ...play('lastWeek', -3, THREE),
      ...play('nextWeek', 8, THREE),
    ];
    // Retries of theme items are not first attempts.
    const t = day(3);
    log.push(
      session('retries', t, 'start'),
      item('retries', 'r.0', 'as.add.20', t + 1),
      item('retries', 'r.0', 'as.add.20', t + 2, { attempt: 2 }),
      item('retries', 'r.1', 'as.sub.20', t + 3),
      item('retries', 'r.1', 'as.sub.20', t + 4, { attempt: 2 }),
      session('retries', t + 5, 'end'),
    );
    expect(weeklyProgress(log, WEEK, bridge).sessions).toBe(0);
  });

  it('counts quick sparks like any other session', () => {
    const log = play('spark', 2, THREE, { quick: true });
    expect(weeklyProgress(log, WEEK, bridge).sessions).toBe(1);
  });

  it('counts a duplicated record (merged devices) once, and caps at the target', () => {
    const dup = play('dup', 0, ['as.add.20', 'as.sub.20']);
    const again = dup.filter((r) => r.type === 'item');
    expect(weeklyProgress([...dup, ...again], WEEK, bridge).sessions).toBe(0);
    const seven = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => play(`s${d}`, d, THREE));
    expect(weeklyProgress(seven, WEEK, bridge)).toMatchObject({ sessions: 5, complete: true });
  });

  it('the mixed theme counts every skill', () => {
    const log = play('any', 1, ['num.count.10', 'md.mult.facts', 'int.addsub']);
    expect(weeklyProgress(log, WEEK, MIXED_THEME).sessions).toBe(1);
    expect(isThemeSkill(MIXED_THEME, 'geo.shapes.basic')).toBe(true);
    expect(isThemeSkill(bridge, 'num.count.10')).toBe(false);
  });
});

describe('weekly reward', () => {
  const done = (week = WEEK): weekly.WeeklyProgress => ({ week, theme: 'bridgeTen', sessions: 5, target: 5, complete: true });
  const partial = (week = WEEK): weekly.WeeklyProgress => ({ ...done(week), sessions: 3, complete: false });

  it('is granted once per week, only when the set is complete', () => {
    let r = weeklyReward(null, partial());
    expect(r).toEqual({ state: { week: WEEK, rewarded: false }, grant: false });
    r = weeklyReward(r.state, done());
    expect(r).toEqual({ state: { week: WEEK, rewarded: true }, grant: true });
    r = weeklyReward(r.state, done());
    expect(r.grant).toBe(false);
    // A new week starts fresh (themes recur; nothing was lost).
    r = weeklyReward(r.state, done('2026-W41'));
    expect(r).toEqual({ state: { week: '2026-W41', rewarded: true }, grant: true });
    // Progress for an older week never changes a newer state.
    expect(weeklyReward(r.state, done(WEEK))).toEqual({ state: r.state, grant: false });
  });

  it('survives a merge with a device that has not granted it yet', () => {
    const phone = weeklyReward(null, done()).state;
    const tablet: WeeklyState = { week: WEEK, rewarded: false };
    const merged = mergeWeekly(tablet, phone)!;
    expect(merged).toEqual({ week: WEEK, rewarded: true });
    expect(weeklyReward(merged, done()).grant).toBe(false);
  });

  it('mergeWeekly is commutative, idempotent and keeps the later week', () => {
    const states: Array<WeeklyState | null> = [
      null,
      { week: WEEK, rewarded: false },
      { week: WEEK, rewarded: true },
      { week: '2026-W41', rewarded: false },
      { week: '2025-W52', rewarded: true },
    ];
    for (const a of states) {
      expect(mergeWeekly(a, a)).toEqual(a);
      for (const b of states) {
        expect(mergeWeekly(a, b)).toEqual(mergeWeekly(b, a));
        for (const c of states) expect(mergeWeekly(mergeWeekly(a, b), c)).toEqual(mergeWeekly(a, mergeWeekly(b, c)));
      }
    }
    expect(mergeWeekly({ week: '2026-W41', rewarded: false }, { week: WEEK, rewarded: true })).toEqual({ week: '2026-W41', rewarded: false });
  });
});

describe('weekly scheduler boost', () => {
  it('boosts exactly the theme skills by 3', () => {
    for (const t of WEEKLY_THEMES) {
      const b = themeBoost(t);
      expect([...b.skills].sort()).toEqual([...t.skills].sort());
      expect(b.factor).toBe(3);
    }
    expect(WEEKLY_BOOST).toBe(3);
    expect(themeBoost(MIXED_THEME).skills.size).toBe(0);
  });

  it('multiplies frontier and review weights, never maintenance or other skills', () => {
    const b = themeBoost(bridge);
    expect(boostedWeight(b, 'as.add.20', 'frontier', 0.5)).toBe(1.5);
    expect(boostedWeight(b, 'as.sub.20', 'review', 0.2)).toBeCloseTo(0.6);
    expect(boostedWeight(b, 'as.add.20', 'maintain', 1)).toBe(1);
    expect(boostedWeight(b, 'num.count.10', 'frontier', 0.5)).toBe(0.5);
    expect(boostedWeight(null, 'as.add.20', 'frontier', 0.5)).toBe(0.5);
    expect(boostedWeight(themeBoost(MIXED_THEME), 'as.add.20', 'frontier', 0.5)).toBe(0.5);
  });
});

describe('weekly guardrails (no countdowns, no loss framing)', () => {
  const TIMEY = /day|left|remain|reset|expire|ends?\b|deadline|hour|countdown|last|miss|lose|lost/i;

  it('progress exposes no days-left or reset information', () => {
    const p = weeklyProgress([], WEEK, bridge);
    expect(Object.keys(p).sort()).toEqual(['complete', 'sessions', 'target', 'theme', 'week']);
  });

  it('no exported name or message key talks about time running out', () => {
    for (const name of Object.keys(weekly)) expect(name).not.toMatch(TIMEY);
    for (const key of Object.values(WEEKLY_KEYS)) expect(key).not.toMatch(TIMEY);
    for (const t of [...WEEKLY_THEMES, MIXED_THEME] as WeeklyTheme[]) {
      expect(weeklyThemeNameKey(t)).toBe(`weekly.theme.${t.id}.name`);
      expect(weeklyThemeDescKey(t)).not.toMatch(TIMEY);
    }
  });
});
