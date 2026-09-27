/**
 * Weekly themed challenge (plan step 6): the pure core (themes, progress,
 * reward, merge, boost) and its integration (set pieces, drops, profile
 * merge, the scheduler boost, the app actions, strings).
 */
import { describe, expect, it } from 'vitest';
import '../src/modes';
import { finishSession, recordAnswer, startSessionFor } from '../src/app/actions';
import { recentLog, saveProfile } from '../src/app/persist';
import { repo } from '../src/app/services';
import { setState } from '../src/app/store';
import { pinWeeklyFor, skillsInPlay, weeklyBoostFor, weeklyView } from '../src/app/weeklyActions';
import { getBand } from '../src/bands/registry';
import { glickoElo } from '../src/core/engine/glicko';
import { replay } from '../src/core/engine/replay';
import { classify } from '../src/core/engine/scheduler';
import { SessionEngine } from '../src/core/engine/session';
import { FLAGS } from '../src/core/flags';
import type { ItemRecord, LogRecord, SessionRecord } from '../src/core/log/types';
import { EVENTS } from '../src/core/log/types';
import { createProfile, normalizeProfile, type Profile } from '../src/core/profile';
import { key, toNumber } from '../src/core/rational';
import { COSMETICS } from '../src/core/rewards/cosmetics';
import { pickCosmetic, rollDrop } from '../src/core/rewards/drops';
import { createRng } from '../src/core/rng';
import { GRAPH } from '../src/core/skills';
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
  pinWeekly,
  rewardFor,
  sessionCounts,
  themeBoost,
  themeFor,
  WEEKLY_BOOST,
  WEEKLY_COSMETICS,
  WEEKLY_KEYS,
  WEEKLY_THEMES,
  weeklyFreeChoice,
  weeklyProgress,
  weeklyReward,
  type WeeklyProgress,
  type WeeklyState,
  type WeeklyTheme,
} from '../src/core/weekly';
import { mergeProfiles } from '../src/data/merge';
import { argumentNames } from '../src/i18n/format';
import { allLocales, getLocale } from '../src/i18n/locales';

const PLAYABLE = SKILLS.filter((s) => s.gens?.length).map((s) => s.id);
const BANDS: BandId[] = ['A', 'B', 'C'];
const EN = getLocale('en').numbers;

// Monday 2026-09-28 … Sunday 2026-10-04 is ISO week 2026-W40 (local time).
const day = (d: number, h = 17): number => new Date(2026, 8, 28 + d, h, 0, 0).getTime();
const WEEK = weekKey(day(0));

function item(sid: string, key_: string, skill: string, ts: number, over: Partial<ItemRecord> = {}): ItemRecord {
  return {
    type: 'item', ts, sid, key: key_, skill, gen: 'addsub', genV: 1, seed: 1, level: 0.3, diff: 0, p: 0.7, mu: 0, s2: 1,
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

/** A session on day `d` with the given first-attempt skills (alternately right and wrong). */
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
const state = (over: Partial<WeeklyState> = {}): WeeklyState => ({ week: WEEK, theme: 'bridgeTen', rewarded: false, ...over });

/** A child placed at grade `g`: skills rebuilt from a synthetic placement, exactly like `__hopa.seed`. */
function placed(name: string, age: number, g: number, t = day(0, 9)): Profile {
  const base = createProfile({ name, age, locale: 'mk', avatar: 'color.green' }, t - 60_000);
  const skills = replay({ graph: GRAPH, model: glickoElo }, [{ type: 'event', ts: t - 30_000, sid: null, name: EVENTS.PLACEMENT_DONE, data: { g, sd: 0.3 } }]);
  return { ...base, skills, placement: { done: true, state: null, g, sd: 0.3 } };
}

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

  it('rewards a registered weekly.* set piece in exactly the bands the theme runs in: pads for A, colours for B, accents for C', () => {
    const slotFor: Record<BandId, string> = { A: 'pad', B: 'color', C: 'theme' };
    for (const t of [...WEEKLY_THEMES, MIXED_THEME]) {
      expect(Object.keys(t.reward).sort()).toEqual([...t.bands].sort());
      for (const b of t.bands) {
        const def = COSMETICS.find((c) => c.id === rewardFor(t, b));
        expect(def, `${t.id}/${b}`).toBeDefined();
        expect(def!.id).toMatch(/^weekly\./);
        expect(def!.source).toBe('weekly');
        expect(def!.slot).toBe(slotFor[b]);
        expect(def!.bands).toContain(b);
      }
    }
  });

  it('every set piece is used by a theme, and all live in the weekly slot', () => {
    const used = new Set([...WEEKLY_THEMES, MIXED_THEME].flatMap((t) => Object.values(t.reward)));
    expect(WEEKLY_COSMETICS.map((c) => c.id).sort()).toEqual([...used].sort());
    expect(COSMETICS.filter((c) => c.id.startsWith('weekly.')).every((c) => c.source === 'weekly')).toBe(true);
    for (const c of WEEKLY_COSMETICS) {
      if (c.slot === 'pad') expect(c.value).toMatch(/gradient\(/); // a patterned pad set, drawn by CSS
      else expect(c.value).toMatch(/^#[0-9a-f]{6}$/);
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
      const partial = themeFor(week, 'B', full.skills.slice(0, 1)); // a sibling with just one of its skills in play
      expect(partial.id).toBe(full.id);
    }
  });

  it('rotates through several themes over a year', () => {
    for (const b of BANDS) {
      const seen = new Set(Array.from({ length: 52 }, (_, i) => themeFor(`2026-W${String(i + 1).padStart(2, '0')}`, b, PLAYABLE).id));
      expect(seen.size, b).toBeGreaterThanOrEqual(4);
    }
  });

  it('only picks a theme for the band with at least one skill in play', () => {
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

  it('falls back to the mixed theme when nothing is in play', () => {
    expect(themeFor('2026-W40', 'A', [])).toBe(MIXED_THEME);
    expect(themeFor('2026-W40', 'C', ['geo.shapes.basic', 'num.subitize.5'])).toBe(MIXED_THEME);
    expect(themeFor('2026-W40', 'A', new Set(['num.count.10'])).id).toBe('counting');
  });

  it('is pinned for the week, re-picked in a new week or when the band changes', () => {
    const pick = (t: WeeklyTheme) => () => t;
    const s = pinWeekly(null, WEEK, 'A', pick(bridge));
    expect(s).toEqual({ week: WEEK, theme: 'bridgeTen', rewarded: false });
    // New skills mid-week never move the theme.
    expect(pinWeekly(s, WEEK, 'A', pick(getWeeklyTheme('counting')!))).toBe(s);
    expect(pinWeekly({ ...s, rewarded: true }, '2026-W41', 'A', pick(getWeeklyTheme('counting')!))).toEqual({ week: '2026-W41', theme: 'counting', rewarded: false });
    // An adult moves the child to Band C: bridgeTen does not run there, so the theme is re-picked (same week, same rewarded flag).
    expect(pinWeekly({ ...s, rewarded: true }, WEEK, 'C', pick(getWeeklyTheme('tables')!))).toEqual({ week: WEEK, theme: 'tables', rewarded: true });
  });
});

describe('weeklyProgress', () => {
  it('counts completed sessions with at least 3 theme first attempts, right or wrong', () => {
    const log = [0, 1, 2, 3, 4].flatMap((d) => play(`s${d}`, d, THREE));
    expect(weeklyProgress(log, WEEK, bridge)).toEqual({ week: WEEK, theme: 'bridgeTen', sessions: 5, target: 5, complete: true });
    expect(weeklyProgress(log.slice(0, 15), WEEK, bridge).sessions).toBe(3);
    expect(sessionCounts(log, WEEK, bridge, 's2')).toBe(true);
  });

  it('does not count short, off-theme, retried, unfinished or other-week sessions', () => {
    const log = [
      ...play('short', 0, ['as.add.20', 'as.sub.20']),
      ...play('offTheme', 1, ['as.add.20', 'as.sub.20', 'num.count.10', 'num.count.10']),
      ...play('unfinished', 2, THREE, { completed: false }),
      ...play('lastWeek', -3, THREE),
      ...play('nextWeek', 8, THREE),
    ];
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
    expect(sessionCounts(log, WEEK, bridge, 'short')).toBe(false);
  });

  it('counts quick sparks like any other session', () => {
    expect(weeklyProgress(play('spark', 2, THREE, { quick: true }), WEEK, bridge).sessions).toBe(1);
  });

  it('counts a duplicated record (merged devices) once, and caps at the target', () => {
    const dup = play('dup', 0, ['as.add.20', 'as.sub.20']);
    const again = dup.filter((r) => r.type === 'item');
    expect(weeklyProgress([...dup, ...again], WEEK, bridge).sessions).toBe(0);
    const seven = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => play(`s${d}`, d, THREE));
    expect(weeklyProgress(seven, WEEK, bridge)).toMatchObject({ sessions: 5, complete: true });
  });

  it('the mixed theme counts every skill', () => {
    expect(weeklyProgress(play('any', 1, ['num.count.10', 'md.mult.facts', 'int.addsub']), WEEK, MIXED_THEME).sessions).toBe(1);
    expect(isThemeSkill(MIXED_THEME, 'geo.shapes.basic')).toBe(true);
    expect(isThemeSkill(bridge, 'num.count.10')).toBe(false);
  });
});

describe('weekly reward and merge', () => {
  const done = (week = WEEK): WeeklyProgress => ({ week, theme: 'bridgeTen', sessions: 5, target: 5, complete: true });
  const partial = (week = WEEK): WeeklyProgress => ({ ...done(week), sessions: 3, complete: false });

  it('is granted once per week, only when the set is complete', () => {
    expect(weeklyReward(state(), partial())).toEqual({ state: state(), grant: false });
    const r = weeklyReward(state(), done());
    expect(r).toEqual({ state: state({ rewarded: true }), grant: true });
    expect(weeklyReward(r.state, done()).grant).toBe(false);
    // Progress for another week never grants against this week's state.
    expect(weeklyReward(state(), done('2026-W39')).grant).toBe(false);
  });

  it('mergeWeekly: rewarded wins within a week, later week wins, and it is a proper merge', () => {
    const states: Array<WeeklyState | null> = [
      null,
      state(),
      state({ rewarded: true }),
      state({ theme: 'tens' }),
      state({ theme: 'tens', rewarded: true }),
      state({ week: '2026-W41' }),
      state({ week: '2025-W52', rewarded: true }),
    ];
    for (const a of states) {
      expect(mergeWeekly(a, a)).toEqual(a);
      for (const b of states) {
        expect(mergeWeekly(a, b)).toEqual(mergeWeekly(b, a));
        for (const c of states) expect(mergeWeekly(mergeWeekly(a, b), c)).toEqual(mergeWeekly(a, mergeWeekly(b, c)));
      }
    }
    expect(mergeWeekly(state({ theme: 'tens' }), state({ rewarded: true }))).toEqual(state({ rewarded: true }));
    expect(mergeWeekly(state({ week: '2026-W41' }), state({ rewarded: true }))).toEqual(state({ week: '2026-W41' }));
  });

  it('the reward survives a profile merge (backup import) with a device that has not granted it', () => {
    const phone = { ...createProfile({ name: 'Ана', age: 6, locale: 'mk', avatar: 'color.green' }, day(0)), weekly: state({ rewarded: true }), updatedAt: day(1) };
    const tablet = { ...phone, weekly: state(), updatedAt: day(2) }; // newer copy, but not rewarded
    for (const merged of [mergeProfiles(phone, tablet), mergeProfiles(tablet, phone)]) {
      expect(merged.weekly).toEqual(state({ rewarded: true }));
      expect(weeklyReward(merged.weekly!, done()).grant).toBe(false);
    }
    expect(mergeProfiles(tablet, tablet).weekly).toEqual(tablet.weekly);
    // Profiles written before the feature have no weekly field: normalised to null, merged without loss.
    const { weekly: _dropped, ...before } = phone;
    const old = normalizeProfile(before);
    expect(old.weekly).toBeNull();
    expect(mergeProfiles(old, phone).weekly).toEqual(phone.weekly);
  });
});

describe('set pieces never drop at random', () => {
  it('pickCosmetic and rollDrop never return a weekly set piece', () => {
    const rng = createRng(4);
    for (const band of BANDS) {
      for (let i = 0; i < 3000; i++) {
        const c = pickCosmetic([], band, rng);
        expect(c?.source ?? 'drop').toBe('drop');
        const roll = rollDrop(40, [], band, rng);
        expect(roll.dropped?.source ?? 'drop').toBe('drop');
      }
    }
  });

  it('with the whole drop pool owned there is nothing left to drop, even with every set piece unowned', () => {
    for (const band of BANDS) {
      const pool = COSMETICS.filter((c) => (c.source ?? 'drop') === 'drop' && c.bands.includes(band)).map((c) => c.id);
      expect(pickCosmetic(pool, band, createRng(1))).toBeNull();
      expect(WEEKLY_COSMETICS.some((c) => c.bands.includes(band))).toBe(true);
    }
  });
});

describe('weekly scheduler boost', () => {
  it('boosts exactly the theme skills by 3, with a themed draw of half the session', () => {
    for (const t of WEEKLY_THEMES) {
      const b = themeBoost(t);
      expect([...b.skills].sort()).toEqual([...t.skills].sort());
      expect(b.factor).toBe(3);
      expect(b.share).toBe(0.5);
    }
    expect(WEEKLY_BOOST).toBe(3);
    expect(themeBoost(MIXED_THEME)).toMatchObject({ share: 0 });
    expect(themeBoost(MIXED_THEME).skills.size).toBe(0);
  });

  it('multiplies frontier and review weights, never maintenance or other skills', () => {
    const b = themeBoost(bridge);
    expect(boostedWeight(b, 'as.add.20', 'frontier', 0.5)).toBe(1.5);
    expect(boostedWeight(b, 'as.sub.20', 'review', 0.2)).toBeCloseTo(0.6);
    expect(boostedWeight(b, 'as.add.20', 'maintain', 1)).toBe(1);
    expect(boostedWeight(b, 'num.count.10', 'frontier', 0.5)).toBe(0.5);
    expect(boostedWeight(null, 'as.add.20', 'frontier', 0.5)).toBe(0.5);
  });

  /**
   * A week of daily Hop sessions (the theme is pinned for a week), repeated for
   * several independent children; returns the theme share of first
   * presentations and the rule checks.
   */
  function simulate(p: Profile, theme: WeeklyTheme, boosted: boolean, sessions = 7, replicas = 6) {
    const band = getBand(p.band);
    const eligibility = { requires: ['numberLine'] as const, allowReading: band.allowReading, reviewFloor: band.reviewFloorGrade };
    let skills = p.skills;
    let t = day(0, 9);
    let first = 0;
    let onTheme = 0;
    const warmupMissed: number[] = [];
    const triples: string[] = [];
    for (let s = 0; s < sessions * replicas; s++) {
      if (s % sessions === 0) {
        skills = p.skills;
        t = day(0, 9);
      }
      const c = classify({ graph: GRAPH, model: glickoElo, states: skills, now: t, rng: createRng(0), eligibility, history: [], newIntroduced: 0 });
      const known = c.review.length + c.maintain.length > 0;
      const eng = new SessionEngine(
        { graph: GRAPH, model: glickoElo, now: () => (t += 4000) },
        { skills, placement: p.placement },
        {
          sessionId: `s${s}`,
          seed: 1000 + s,
          band: { id: band.id, targetP: band.targetP, allowReading: band.allowReading, maxReturns: band.maxReturns, reviewFloor: band.reviewFloorGrade },
          mode: { id: 'hop', requires: ['numberLine'] },
          plannedItems: 12,
          stretch: false,
          timed: false,
          ...(boosted ? { boost: themeBoost(theme) } : {}),
        },
      );
      const rng = createRng(77 + s);
      const hist: Array<{ skill: string; source: string }> = [];
      for (let pi = eng.next(); pi; pi = eng.next()) {
        hist.push({ skill: pi.item.skillId, source: pi.source });
        if (pi.attempt === 1) {
          first++;
          if (theme.skills.includes(pi.item.skillId)) onTheme++;
        }
        const v = toNumber(pi.item.answer.value);
        const raw = rng.chance(0.8) ? key(pi.item.answer.value) : String(Math.round(v) + 7);
        eng.answer(pi, { response: { kind: 'typed', raw }, latencyMs: 3000, hint: false, locale: 'en', conv: EN, input: 'typed' });
      }
      if (known && hist[0]?.source !== 'warmup') warmupMissed.push(s);
      for (let i = 2; i < hist.length; i++) {
        const h = hist[i]!;
        if (h.source !== 'retry' && h.skill === hist[i - 1]!.skill && h.skill === hist[i - 2]!.skill) triples.push(`${s}:${i}:${h.skill}`);
      }
      skills = eng.snapshot.skills;
      t += 86_400_000;
    }
    return { share: onTheme / first, warmupMissed, triples };
  }

  // Learners placed like `__hopa.seed`, each with the theme the app would pin for them in a few different weeks.
  const learners: Array<[string, Profile]> = [
    ['A 1.2', placed('Ана', 6, 1.2)],
    ['A 2.4', placed('Ана', 7, 2.4)],
    ['B 3.5', placed('Марко', 9, 3.5)],
    ['B 5.0', placed('Марко', 10, 5)],
    ['C 7.0', placed('Стефан', 13, 7)],
  ];
  for (const [name, p] of learners) {
    const themes = new Set([0, 1, 2, 3, 5, 8].map((w) => themeFor(weekKey(day(7 * w)), p.band, skillsInPlay(p, day(0, 9))).id));
    themes.delete(MIXED_THEME.id);
    for (const id of themes) {
      it(`raises the theme share to at least 40%, keeps warm-up and no-three-in-a-row (${name}, ${id})`, () => {
        const theme = getWeeklyTheme(id)!;
        const plain = simulate(p, theme, false);
        const boosted = simulate(p, theme, true);
        const msg = `plain ${plain.share.toFixed(2)} → boosted ${boosted.share.toFixed(2)}`;
        expect(boosted.share, msg).toBeGreaterThanOrEqual(0.4);
        expect(boosted.share, msg).toBeGreaterThanOrEqual(plain.share - 0.02);
        expect(boosted.warmupMissed).toEqual([]);
        expect(boosted.triples).toEqual([]);
      });
    }
  }

  it('sessions without a boost are unchanged (same items as before the feature)', () => {
    const p = placed('Марко', 9, 3.5);
    const band = getBand(p.band);
    const run = (boost?: ReturnType<typeof themeBoost>): string[] => {
      let t = day(0, 9);
      const eng = new SessionEngine(
        { graph: GRAPH, model: glickoElo, now: () => (t += 4000) },
        { skills: p.skills, placement: p.placement },
        {
          sessionId: 'x', seed: 5,
          band: { id: band.id, targetP: band.targetP, allowReading: band.allowReading, maxReturns: band.maxReturns, reviewFloor: band.reviewFloorGrade },
          mode: { id: 'hop', requires: ['numberLine'] }, plannedItems: 10, stretch: false, timed: false,
          ...(boost ? { boost } : {}),
        },
      );
      const out: string[] = [];
      for (let pi = eng.next(); pi; pi = eng.next()) {
        out.push(`${pi.item.skillId}:${pi.item.seed}`);
        eng.answer(pi, { response: { kind: 'typed', raw: key(pi.item.answer.value) }, latencyMs: 3000, hint: false, locale: 'en', conv: EN, input: 'typed' });
      }
      return out;
    };
    expect(run(themeBoost(MIXED_THEME))).toEqual(run());
    expect(run(themeBoost(getWeeklyTheme('tens')!))).not.toEqual(run());
  });
});

describe('weekly in the app: pin, boost, lit stones, the reward once', () => {
  const answerAll = (p0: Profile, themeId: string | undefined) => {
    let p = p0;
    let s = startSessionFor(p, 'hop', themeId ? { theme: themeId } : {})!;
    for (let pi = s.engine.next(); pi; pi = s.engine.next()) {
      const r = recordAnswer(p, s, pi, { kind: 'typed', raw: key(pi.item.answer.value) }, { latencyMs: 2500, hint: false, input: 'typed', hops: 0 });
      p = r.profile;
      s = r.session;
    }
    return finishSession(p, s, true);
  };

  it('a child plays five themed sessions: stones light, the set piece arrives once, WEEKLY_DONE is logged', () => {
    repo.init();
    // Seasonal touches off: in a seasonal week (tests/seasons.test.ts) the season's theme would replace the ordinary one.
    let p = saveProfile(pinWeeklyFor({ ...placed('Марко', 9, 3.5, Date.now()), flags: { season: false } }, Date.now()));
    setState({ profile: p, profiles: [p], session: null, meta: repo.meta() });
    const view = weeklyView(p, Date.now())!;
    expect(view.theme.id).toBe(p.weekly!.theme);
    expect(view.progress.sessions).toBe(0);
    const piece = view.reward!;
    expect(piece).toMatch(/^weekly\..*\.color$/);

    const extras: string[][] = [];
    let lit = 0;
    for (let i = 0; i < 12 && lit < 6; i++) {
      const { profile, result } = answerAll(p, view.theme.id);
      p = profile;
      extras.push((result.extras ?? []).map((e) => e.key));
      if (result.extras?.some((e) => e.key === WEEKLY_KEYS.stone)) lit++;
      if (result.extras?.some((e) => e.key === WEEKLY_KEYS.reward)) {
        expect(result.gifts).toContain(piece);
        expect(p.rewards.pending).toContain(piece);
      }
    }
    expect(lit).toBeGreaterThanOrEqual(6); // five to finish, then one more
    const rewards = extras.flat().filter((k) => k === WEEKLY_KEYS.reward);
    expect(rewards).toHaveLength(1);
    expect(p.weekly).toMatchObject({ rewarded: true, theme: view.theme.id });
    expect(p.rewards.pending.filter((id) => id === piece)).toHaveLength(1);
    const done = recentLog(p.id).filter((r) => r.type === 'event' && r.name === EVENTS.WEEKLY_DONE);
    expect(done).toHaveLength(1);
    expect(weeklyView(p, Date.now())!.progress).toMatchObject({ sessions: 5, complete: true });
    // Themed sessions record their theme in the log.
    expect(recentLog(p.id).some((r) => r.type === 'session' && r.opts.theme === view.theme.id)).toBe(true);
  });

  it('the boost reaches the engine only for a real theme with the flag on', () => {
    const p = placed('Ана', 6, 1.2);
    expect(weeklyBoostFor(p, 'bridgeTen')?.skills.has('as.add.20')).toBe(true);
    expect(weeklyBoostFor(p, undefined)).toBeUndefined();
    expect(weeklyBoostFor(p, 'mixed')).toBeUndefined();
    expect(weeklyBoostFor(p, 'nope')).toBeUndefined();
    expect(weeklyBoostFor({ ...p, flags: { weekly: false } }, 'bridgeTen')).toBeUndefined();
  });

  it('nothing is shown or pinned before placement or with the flag off', () => {
    const fresh = createProfile({ name: 'Нова', age: 7, locale: 'mk', avatar: 'color.green' }, Date.now());
    expect(weeklyView(fresh, Date.now())).toBeNull();
    expect(pinWeeklyFor(fresh, Date.now())).toBe(fresh);
    const off = { ...placed('Ана', 6, 1.2), flags: { weekly: false } };
    expect(weeklyView(off, Date.now())).toBeNull();
    expect(pinWeeklyFor(off, Date.now()).weekly).toBeNull();
  });

  it('the theme comes from skills in play: a strong child is never pinned to skills they have mastered', () => {
    const p = placed('Стефан', 10, 5.5);
    for (let w = 1; w <= 20; w++) {
      const t = day(7 * w);
      const pinned = pinWeeklyFor({ ...p, weekly: null }, t).weekly!;
      const theme = getWeeklyTheme(pinned.theme)!;
      if (theme.id === MIXED_THEME.id || theme.season) continue; // seasonal weeks count every skill
      const inPlay = skillsInPlay(p, t);
      expect(theme.skills.some((s) => inPlay.includes(s)), theme.id).toBe(true);
    }
  });

  it('the weekly flag is profile-scoped, on by default, labelled in the weekly block', () => {
    expect(FLAGS.find((f) => f.id === 'weekly')).toMatchObject({ scope: 'profile', default: true, labelKey: 'weekly.flag' });
  });
});

describe('free-choice measure after the set', () => {
  it('is the share of that week\'s first attempts answered after WEEKLY_DONE', () => {
    const log: LogRecord[] = [
      ...play('a', 0, THREE),
      { type: 'event', ts: day(1), sid: 'a', name: EVENTS.WEEKLY_DONE, data: { week: WEEK } },
      ...play('b', 2, ['as.add.20']),
      ...play('other', 9, THREE), // another week without a completed set: ignored
    ];
    expect(weeklyFreeChoice(log)).toBeCloseTo(1 / 4);
    expect(weeklyFreeChoice(play('x', 0, THREE))).toBeNull();
  });
});

describe('weekly guardrails (no countdowns, no loss framing)', () => {
  const TIME_EN = /\bdays?\b|\bleft\b|remain|reset|expir|deadline|hurry|\bhours?\b|countdown|\blast\b|\bmiss|\bends?\b|\bonly\b|limited/i;
  const TIME_MK = /(?<!\p{L})(ден|дена|денови|час|часа|рок)(?!\p{L})|останува|остануваат|истекува|брзај|последн|пропушт|ограничен/iu;
  const weeklyKeys = (msgs: Record<string, string>): string[] =>
    Object.keys(msgs).filter((k) => k.startsWith('weekly.') || k.startsWith('voice.weekly.') || k.startsWith('cos.weekly.'));

  it('no weekly string has a time or days placeholder, and none speaks of time running out', () => {
    for (const loc of allLocales()) {
      const keys = weeklyKeys(loc.messages);
      expect(keys.length).toBeGreaterThan(40);
      for (const k of keys) {
        const msg = loc.messages[k]!;
        for (const arg of argumentNames(msg)) expect(['done', 'target', 'pct'], `${loc.id}:${k} {${arg}}`).toContain(arg);
        expect(msg, `${loc.id}:${k}`).not.toMatch(loc.id === 'mk' ? TIME_MK : TIME_EN);
      }
    }
  });

  it('every theme and set piece has its strings; progress exposes no days-left or reset data', () => {
    const en = getLocale('en').messages;
    for (const t of [...WEEKLY_THEMES, MIXED_THEME]) {
      expect(en[`weekly.theme.${t.id}.name`], t.id).toBeTruthy();
      expect(en[`weekly.theme.${t.id}.desc`], t.id).toBeTruthy();
    }
    for (const c of WEEKLY_COSMETICS) expect(en[`cos.${c.id}`], c.id).toBeTruthy();
    for (const k of Object.values(WEEKLY_KEYS)) expect(en[k], k).toBeTruthy();
    expect(Object.keys(weeklyProgress([], WEEK, bridge)).sort()).toEqual(['complete', 'sessions', 'target', 'theme', 'week']);
    for (const name of Object.keys(weekly)) expect(name).not.toMatch(/days|left|remain|reset|expire|deadline|countdown/i);
  });
});
