/**
 * School years and today's challenges (DESIGN A-29): the year mapping and the
 * default year, the scheduler restricted to a year (no walls inside it,
 * warm-up and no-three-in-a-row kept, placement regardless of year, the Band A
 * reading filter), which modes and years have content, the daily set
 * (deterministic per day, different the next day), ticks and their merge, the
 * gift once per child per day, the quest equivalence, puzzles by year, the
 * year on session records, and the guardrails on wording.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import '../src/modes';
import { finishSession, recordAnswer, startSessionFor } from '../src/app/actions';
import { recentLog, saveProfile } from '../src/app/persist';
import { beginPuzzle, completePuzzle, endPuzzleSession, startPuzzleSession } from '../src/app/puzzleActions';
import { repo } from '../src/app/services';
import { setState } from '../src/app/store';
import {
  challengeOptions,
  extrasFor,
  modeReadyInYear,
  modeYearSkills,
  nearestYearFor,
  practiceMode,
  selectedYear,
  todaysSet,
  todayView,
  yearsFor,
} from '../src/app/yearActions';
import { overview, yearsTried } from '../src/adult/analytics';
import { getBand } from '../src/bands/registry';
import { evaluateAchievements, evalCondition } from '../src/core/achievements';
import type { AchievementDef } from '../src/core/achievements/types';
import {
  challengeDay,
  challengeFromId,
  dailyChallenges,
  EXTRA_KINDS,
  mergeChallenges,
  pinSet,
  setComplete,
  tick,
  type ChallengeDay,
} from '../src/core/challenges';
import { glickoElo } from '../src/core/engine/glicko';
import { replay } from '../src/core/engine/replay';
import { classify } from '../src/core/engine/scheduler';
import { SessionEngine } from '../src/core/engine/session';
import type { ItemRecord, SessionRecord } from '../src/core/log/types';
import { EVENTS } from '../src/core/log/types';
import { createProfile, normalizeProfile, type Profile } from '../src/core/profile';
import { key } from '../src/core/rational';
import { createRng } from '../src/core/rng';
import { BAND_GRADES, GRAPH } from '../src/core/skills';
import { addDays, dayKey } from '../src/core/time';
import type { BandId } from '../src/core/types';
import {
  inYear,
  MAX_YEAR,
  nearestYear,
  ownYear,
  PUZZLE_TYPE_IDS,
  PUZZLE_YEAR_SHIFT,
  puzzleLevelShift,
  puzzleTypeIdsFor,
  puzzleTypesForYear,
  yearBand,
  yearOfGrade,
} from '../src/core/years';
import { mergeProfiles } from '../src/data/merge';
import { argumentNames } from '../src/i18n/format';
import { allLocales, getLocale } from '../src/i18n/locales';
import { getMode } from '../src/modes/registry';
import { getPuzzleType, puzzleTypesFor, startPuzzle } from '../src/puzzles';

const EN = getLocale('en').numbers;
const T0 = Date.now();

function placed(name: string, age: number, g: number, over: Partial<Profile> = {}): Profile {
  const base = createProfile({ name, age, locale: 'mk', avatar: 'color.green' }, T0 - 60_000);
  const skills = replay({ graph: GRAPH, model: glickoElo }, [{ type: 'event', ts: T0 - 30_000, sid: null, name: EVENTS.PLACEMENT_DONE, data: { g, sd: 0.3 } }]);
  return { ...base, skills, placement: { done: true, state: null, g, sd: 0.3 }, ...over };
}

function engineFor(p: Profile, year: number | undefined, opts: { seed?: number; planned?: number; modeId?: string } = {}): SessionEngine {
  const band = getBand(p.band);
  const mode = getMode(opts.modeId ?? 'hop')!;
  return new SessionEngine(
    { graph: GRAPH, model: glickoElo, now: () => T0 },
    { skills: p.skills, placement: mode.placement ? p.placement : { ...p.placement, state: null } },
    {
      sessionId: 's',
      seed: opts.seed ?? 1,
      band: { id: band.id, targetP: band.targetP, allowReading: band.allowReading, maxReturns: 0, reviewFloor: band.reviewFloorGrade },
      mode: { id: mode.id, requires: mode.requires, ...(mode.filter ? { filter: mode.filter } : {}) },
      plannedItems: opts.planned ?? 30,
      stretch: false,
      timed: false,
      ...(year !== undefined ? { year } : {}),
    },
  );
}

/** Serve and answer (right) every item; returns the served items. */
function run(eng: SessionEngine): Array<{ skill: string; gen: string; source: string }> {
  const out: Array<{ skill: string; gen: string; source: string }> = [];
  for (let pi = eng.next(); pi; pi = eng.next()) {
    out.push({ skill: pi.item.skillId, gen: pi.item.genId, source: pi.source });
    eng.answer(pi, { response: { kind: 'typed', raw: key(pi.item.answer.value) }, latencyMs: 3000, hint: false, locale: 'en', conv: EN, input: 'typed' });
  }
  return out;
}

beforeEach(() => {
  repo.init();
  setState({ meta: repo.meta(), profile: null, profiles: [], session: null });
});

describe('year mapping (catalog convention: 4.5 = middle of одделение 4)', () => {
  it('year N holds grades [N, N + 1); year 0 is pre-school', () => {
    expect(yearOfGrade(0)).toBe(0);
    expect(yearOfGrade(0.8)).toBe(0);
    expect(yearOfGrade(1)).toBe(1);
    expect(yearOfGrade(4.5)).toBe(4);
    expect(yearOfGrade(4.999)).toBe(4);
    expect(yearOfGrade(5)).toBe(5);
    expect(yearOfGrade(9.5)).toBe(9);
    expect(inYear(GRAPH.get('f.equiv'), 4)).toBe(true);
    expect(inYear(GRAPH.get('f.equiv'), 5)).toBe(false);
    for (const s of GRAPH.skills) expect(inYear(s, Math.floor(s.grade)), s.id).toBe(true);
  });

  it('the default year is the child’s school year from age: MK children start одделение 1 at 6', () => {
    expect([3, 5, 6, 7, 10, 11, 12, 14, 16].map(ownYear)).toEqual([0, 0, 1, 2, 5, 6, 7, 9, 9]);
  });

  it('a year’s band matches the bands’ grade windows (puzzle types by year)', () => {
    for (let y = 0; y <= MAX_YEAR; y++) {
      const b = yearBand(y);
      expect(y >= BAND_GRADES[b][0] && y < BAND_GRADES[b][1], `${y} in ${b}`).toBe(true);
    }
  });

  it('nearestYear keeps a listed year and otherwise moves to the closest (ties go lower)', () => {
    expect(nearestYear(5, [3, 4, 5, 6])).toBe(5);
    expect(nearestYear(9, [0, 1, 7, 8])).toBe(8);
    expect(nearestYear(5, [3, 7])).toBe(3);
    expect(nearestYear(2, [])).toBeNull();
  });
});

describe('which years and modes have content', () => {
  it('the bar lists only years with a playable skill a visible mode can serve (B/C to year 8 through Balance; A to year 7)', () => {
    const b = placed('Марко', 9, 3.5);
    const a = placed('Ана', 6, 1.2);
    expect(yearsFor(b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(yearsFor(a)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Every listed year has at least one playable skill; year 9 has none yet.
    for (const y of yearsFor(b)) expect(GRAPH.playableSkills().some((s) => inYear(s, y)), String(y)).toBe(true);
    expect(GRAPH.playableSkills().some((s) => inYear(s, 9))).toBe(false);
  });

  it('the year shown is the one last chosen, else the own year, moved to the nearest listed year', () => {
    expect(selectedYear(placed('Лена', 10, 4.5))).toBe(5);
    expect(selectedYear(placed('Стефан', 14, 7))).toBe(8); // own year 9 has nothing yet
    expect(selectedYear(placed('Лена', 10, 4.5, { year: 3 }))).toBe(3);
    expect(selectedYear(normalizeProfile({ id: 'old', name: 'Old', age: 8 }))).toBe(3); // a profile from before the bar
  });

  it('a mode with nothing in a year is not ready there and knows the nearest year that has some', () => {
    const b = placed('Марко', 9, 3.5);
    const balance = getMode('balance')!;
    expect(modeYearSkills(balance, b, 5)).toEqual([]);
    expect(modeReadyInYear(balance, b, 5)).toBe(false);
    expect(nearestYearFor(balance, b, 5)).toBe(7);
    // No walls inside a year: equations are locked for this child, yet year 7's Balance can be tried.
    expect(modeReadyInYear(balance, b, 7)).toBe(true);
    const workshop = getMode('workshop')!;
    expect(modeYearSkills(workshop, b, 4).map((s) => s.id).sort()).toEqual(['f.equiv', 'geo.area.rect']);
    expect(modeReadyInYear(getMode('hop')!, b, 8)).toBe(false);
    expect(nearestYearFor(getMode('hop')!, b, 8)).toBe(7);
  });

  it('before placement only Number Trail can start, in any year (its first session places the child)', () => {
    const fresh = createProfile({ name: 'Нова', age: 9, locale: 'mk', avatar: 'color.green' }, T0);
    expect(modeReadyInYear(getMode('hop')!, fresh, 8)).toBe(true);
    expect(modeReadyInYear(getMode('target')!, fresh, 3)).toBe(false);
    expect(modeReadyInYear(getMode('puzzle')!, fresh, 3)).toBe(false);
  });

  it('Band A keeps its reading filter in every year: make 10 is its only Target content', () => {
    const a = placed('Ана', 6, 1.2);
    expect(modeYearSkills(getMode('target')!, a, 1).map((s) => s.id)).toEqual(['as.bonds.10']);
    expect(modeYearSkills(getMode('target')!, a, 3)).toEqual([]);
    expect(modeYearSkills(getMode('target')!, placed('Марко', 9, 3.5), 3).length).toBeGreaterThan(0);
  });
});

describe('the scheduler in a chosen year', () => {
  it('serves only that year’s skills, locked ones included (no walls), and progress stays per skill', () => {
    const p = placed('Марко', 9, 3.5);
    const inYear5 = GRAPH.playableSkills().filter((s) => inYear(s, 5)).map((s) => s.id);
    expect(inYear5.length).toBeGreaterThan(0);
    for (const seed of [1, 2, 3]) {
      const served = run(engineFor(p, 5, { seed }));
      expect(served.length).toBe(30);
      for (const it of served) expect(inYear5, it.skill).toContain(it.skill);
    }
    // Those skills were locked for a grade-3.5 child: a session without a year never serves them.
    const plain = run(engineFor(p, undefined));
    expect(plain.some((it) => inYear5.includes(it.skill))).toBe(false);
  });

  it('keeps the warm-up and never serves one skill three times in a row within the year', () => {
    const p = placed('Лена', 10, 4.6);
    for (const seed of [4, 5, 6, 7]) {
      const served = run(engineFor(p, 3, { seed }));
      expect(served[0]!.source).toBe('warmup');
      for (let i = 2; i < served.length; i++) {
        expect(served[i]!.skill === served[i - 1]!.skill && served[i]!.skill === served[i - 2]!.skill, `seed ${seed} item ${i}`).toBe(false);
      }
    }
  });

  it('ignores the band’s review floor: a teen who picks year 1 practises year 1', () => {
    const teen = placed('Стефан', 13, 7);
    const served = run(engineFor(teen, 1, { planned: 12 }));
    expect(served.length).toBe(12);
    for (const it of served) expect(inYear(GRAPH.get(it.skill), 1), it.skill).toBe(true);
  });

  it('keeps the Band A reading filter: no word problems in a pre-reader’s year-2 session', () => {
    const a = placed('Ана', 7, 2.2);
    const served = run(engineFor(a, 2, { seed: 9, planned: 40 }));
    expect(served.some((it) => it.skill === 'as.add.100' || it.skill === 'as.sub.100')).toBe(true);
    expect(served.every((it) => it.gen !== 'word')).toBe(true);
    const b = placed('Марко', 9, 2.4);
    expect(run(engineFor(b, 2, { seed: 9, planned: 80 })).some((it) => it.gen === 'word')).toBe(true);
  });

  it('still places a new child first, whatever the year', () => {
    const fresh = createProfile({ name: 'Нова', age: 9, locale: 'mk', avatar: 'color.green' }, T0);
    const served = run(engineFor(fresh, 7, { planned: 12 }));
    expect(served[0]!.source).toBe('placement');
    expect(served.filter((it) => it.source === 'placement').length).toBeGreaterThanOrEqual(5);
    // After placement the rest of the session keeps to year 7.
    for (const it of served.filter((x) => x.source !== 'placement')) expect(inYear(GRAPH.get(it.skill), 7), it.skill).toBe(true);
  });

  it('without a year nothing changes: classify gives the same buckets as before', () => {
    const p = placed('Марко', 9, 3.5);
    const band = getBand('B');
    const input = { graph: GRAPH, model: glickoElo, states: p.skills, now: T0, rng: createRng(0), history: [], newIntroduced: 0 };
    const elig = { requires: ['numberLine'] as const, allowReading: true, reviewFloor: band.reviewFloorGrade };
    const ids = (b: ReturnType<typeof classify>): string[][] => [b.frontier, b.review, b.maintain].map((c) => c.map((x) => `${x.skill.id}:${x.weight.toFixed(6)}`));
    expect(ids(classify({ ...input, eligibility: { ...elig, year: undefined } }))).toEqual(ids(classify({ ...input, eligibility: elig })));
  });
});

describe('today’s challenges: the daily set', () => {
  const input = { pid: 'p1', year: 3, day: '2026-09-28', fits: ['target', 'workshop', 'fracdec', 'sprint'] as const, puzzleTypes: ['pattern', 'balance', 'estimate', 'logic'] };

  it('is 3–4 challenges: the practice first, one puzzle, one or two extras that fit', () => {
    for (let d = 0; d < 60; d++) {
      const set = dailyChallenges({ ...input, day: addDays(input.day, d) });
      expect(set.length).toBeGreaterThanOrEqual(3);
      expect(set.length).toBeLessThanOrEqual(4);
      expect(set[0]).toEqual({ id: 'practice', kind: 'practice' });
      expect(set.filter((c) => c.kind === 'puzzle')).toHaveLength(1);
      for (const c of set.slice(2)) expect(input.fits).toContain(c.kind);
      expect(new Set(set.map((c) => c.id)).size).toBe(set.length);
      for (const c of set) expect(challengeFromId(c.id)).toEqual(c);
    }
  });

  it('is the same all day and different the next day', () => {
    const days = Array.from({ length: 40 }, (_, d) => addDays(input.day, d));
    const sets = days.map((day) => JSON.stringify(dailyChallenges({ ...input, day })));
    expect(days.map((day) => JSON.stringify(dailyChallenges({ ...input, day })))).toEqual(sets);
    for (let i = 1; i < sets.length; i++) expect(sets[i], days[i]).not.toBe(sets[i - 1]);
    // Every extra shows up over a few weeks.
    const seen = new Set(days.flatMap((day) => dailyChallenges({ ...input, day }).map((c) => c.kind)));
    for (const k of input.fits) expect(seen.has(k), k).toBe(true);
  });

  it('fills a thin year with a second puzzle type, else a quick spark', () => {
    expect(dailyChallenges({ ...input, fits: [] }).map((c) => c.kind)).toEqual(['practice', 'puzzle', 'puzzle']);
    expect(dailyChallenges({ ...input, fits: [], puzzleTypes: ['pattern'] }).map((c) => c.kind)).toEqual(['practice', 'puzzle', 'spark']);
    expect(dailyChallenges({ ...input, fits: ['sprint'], puzzleTypes: [] }).map((c) => c.kind)).toEqual(['practice', 'sprint', 'spark']);
  });

  it('extras follow the year: Workshop and a fraction focus in year 3–4, Balance and coordinates from year 7, nothing extra in year 5', () => {
    const b = placed('Марко', 9, 3.5);
    expect(extrasFor(b, 3)).toEqual(['target', 'workshop', 'fracdec']);
    // Sprint once a fact of that year is Solid (times tables are, for a child placed in year 4).
    expect(extrasFor(placed('Лена', 10, 4.8), 3)).toContain('sprint');
    expect(extrasFor(b, 4)).toEqual(expect.arrayContaining(['workshop', 'fracdec']));
    expect(extrasFor(b, 4)).not.toContain('balance');
    expect(extrasFor(b, 7)).toEqual(expect.arrayContaining(['target', 'balance', 'coord']));
    expect(extrasFor(b, 5)).toEqual([]);
    // Sprint only with a Solid fact of that year; never for Band A (no timers).
    expect(extrasFor(b, 7)).not.toContain('sprint');
    expect(extrasFor(placed('Ана', 6, 2.5), 1)).not.toContain('sprint');
    for (const k of extrasFor(b, 3)) expect(EXTRA_KINDS).toContain(k);
  });

  it('year 8 practises on the Balance (Number Trail has nothing there), never twice', () => {
    const teen = placed('Стефан', 13, 8.2);
    expect(practiceMode(teen, 8)?.id).toBe('balance');
    expect(extrasFor(teen, 8)).not.toContain('balance');
    expect(practiceMode(teen, 7)?.id).toBe('hop');
  });

  it('before placement only the practice opens; it is long enough to place the child', () => {
    const fresh = createProfile({ name: 'Нова', age: 9, locale: 'mk', avatar: 'color.green' }, T0);
    const view = todayView(fresh, 4, T0)!;
    expect(view.items.map((i) => [i.challenge.kind, i.open])).toEqual(view.items.map((i) => [i.challenge.kind, i.challenge.kind === 'practice']));
    const practice = view.items[0]!;
    expect(challengeOptions(practice.challenge, fresh, 4, practice.mode!)).toMatchObject({ year: 4, challenge: 'practice', items: 8 });
    const p = placed('Марко', 9, 3.5);
    expect(challengeOptions(practice.challenge, p, 4, getMode('hop')!)).toMatchObject({ items: 6 });
    expect(todayView(p, 4, T0)!.items.every((i) => i.open)).toBe(true);
  });

  it('switches off with the daily quest’s flag (they replaced its card)', () => {
    expect(todayView(placed('Марко', 9, 3.5, { flags: { 'quests.daily': false } }), 4, T0)).toBeNull();
  });
});

describe('ticks: state and merge', () => {
  const DAY = '2026-09-28';
  const base = pinSet(challengeDay(null, DAY), 5, ['practice', 'puzzle.pattern', 'puzzle.balance']);

  it('ticks are idempotent and complete a pinned set', () => {
    let s = tick(base, 5, 'practice');
    expect(tick(s, 5, 'practice')).toBe(s);
    expect(setComplete(s, 5)).toBe(false);
    s = tick(tick(s, 5, 'puzzle.pattern'), 5, 'puzzle.balance');
    expect(setComplete(s, 5)).toBe(true);
    expect(setComplete(s, 6)).toBe(false);
    // Another day starts empty.
    expect(challengeDay(s, '2026-09-29')).toEqual({ day: '2026-09-29', sets: {}, done: {}, rewarded: false });
  });

  it('merge: the later day wins; on the same day ticks are a union, the gift flag an OR; idempotent', () => {
    const a: ChallengeDay = tick(base, 5, 'practice');
    const b: ChallengeDay = { ...tick(tick(base, 5, 'puzzle.pattern'), 6, 'spark'), rewarded: true };
    const m = mergeChallenges(a, b)!;
    expect(m.done['5']!.sort()).toEqual(['practice', 'puzzle.pattern']);
    expect(m.done['6']).toEqual(['spark']);
    expect(m.rewarded).toBe(true);
    expect(mergeChallenges(m, b)).toEqual(m);
    expect(mergeChallenges(m, m)).toEqual(m);
    expect(mergeChallenges(b, a)!.done['5']!.sort()).toEqual(m.done['5']!.sort());
    const later: ChallengeDay = { ...challengeDay(null, '2026-09-29') };
    expect(mergeChallenges(m, later)).toBe(later);
    expect(mergeChallenges(later, m)).toBe(later);
    expect(mergeChallenges(null, m)).toBe(m);
  });

  it('profile merge keeps both devices’ ticks and the year chosen on the later one', () => {
    const p = placed('Марко', 9, 3.5);
    const a = { ...p, updatedAt: 1, year: 4, challenges: tick(base, 5, 'practice') };
    const b = { ...p, updatedAt: 2, year: null, challenges: tick(base, 5, 'puzzle.balance') };
    const m = mergeProfiles(a, b);
    expect(m.challenges!.done['5']!.sort()).toEqual(['practice', 'puzzle.balance']);
    expect(m.year).toBe(4);
    expect(mergeProfiles(a, { ...b, year: 6 }).year).toBe(6);
    expect(normalizeProfile({ id: 'x', name: 'X' })).toMatchObject({ year: null, challenges: null });
  });
});

describe('today’s challenges in the app: ticks, the gift once a day, the quest equivalence', () => {
  const answerAll = (p0: Profile, opts: Parameters<typeof startSessionFor>[2]) => {
    let p = p0;
    let s = startSessionFor(p, 'hop', opts)!;
    for (let pi = s.engine.next(); pi; pi = s.engine.next()) {
      const r = recordAnswer(p, s, pi, { kind: 'typed', raw: key(pi.item.answer.value) }, { latencyMs: 2500, hint: false, input: 'typed', hops: 0 });
      p = r.profile;
      s = r.session;
    }
    return finishSession(p, s, true);
  };
  const solvePuzzle = (p: Profile, year: number, id: string, solved = true) => {
    const s = startPuzzleSession(p, { year, challenge: id });
    const started = beginPuzzle(p, id.slice(7), false, year);
    const r = completePuzzle(p, s, started, { solved, hints: 1, wrongChecks: 2 });
    endPuzzleSession(r.profile, r.session);
    return r;
  };

  it('a year-5 set (practice and two puzzles): each tick shows on the results, the set brings one gift and a quest_done', () => {
    let p = saveProfile(placed('Лена', 10, 5.5));
    setState({ profile: p, profiles: [p], meta: repo.meta() });
    const set = todaysSet(p, 5, Date.now());
    expect(set.map((c) => c.kind)).toEqual(['practice', 'puzzle', 'puzzle']);

    // The practice: a short session on year 5, ticked when it runs to the end.
    const r1 = answerAll(p, challengeOptions(set[0]!, p, 5, getMode('hop')!));
    p = r1.profile;
    expect(r1.result.firstAttempts).toBe(6);
    expect(r1.result.extras).toEqual(expect.arrayContaining([{ key: 'year.today.ticked', params: { done: 1, total: 3 } }]));
    const items = recentLog(p.id).filter((r): r is ItemRecord => r.type === 'item');
    for (const it of items) expect(inYear(GRAPH.get(it.skill), 5), it.skill).toBe(true);

    // A revealed puzzle does not tick (Band B); a solved one does, hints and wrong checks allowed.
    p = solvePuzzle(p, 5, set[1]!.id, false).profile;
    expect(todayView(p, 5, Date.now())!.done).toBe(1);
    p = solvePuzzle(p, 5, set[1]!.id).profile;
    expect(todayView(p, 5, Date.now())!.done).toBe(2);
    // Puzzles have no surprise drops, so the one new pending gift is today's.
    const pending0 = p.rewards.pending.length;
    const last = solvePuzzle(p, 5, set[2]!.id);
    p = last.profile;
    expect(last.gifts).toHaveLength(1);
    expect(p.rewards.pending.length).toBe(pending0 + 1);
    expect(todayView(p, 5, Date.now())).toMatchObject({ complete: true, rewarded: true, done: 3 });
    const quests = recentLog(p.id).filter((r) => r.type === 'event' && r.name === EVENTS.QUEST_DONE);
    expect(quests).toHaveLength(1);
    expect(quests[0]!.type === 'event' && quests[0]!.data).toMatchObject({ year: 5, via: 'challenges' });

    // Another year's set the same day: ticks, but no second gift and no second quest_done.
    const set4 = todaysSet(p, 4, Date.now());
    const lines: string[] = [];
    const gifts: string[] = [];
    for (const c of set4) {
      if (c.kind === 'puzzle') {
        const r = solvePuzzle(p, 4, c.id);
        p = r.profile;
        gifts.push(...r.gifts);
      } else if (c.kind === 'practice' || c.kind === 'fracdec' || c.kind === 'spark') {
        const r = answerAll(p, challengeOptions(c, p, 4, getMode('hop')!));
        p = r.profile;
        lines.push(...(r.result.extras ?? []).map((e) => e.key));
      } else p = saveProfile({ ...p, challenges: tick(p.challenges!, 4, c.id) });
    }
    expect(todayView(p, 4, Date.now())!.complete).toBe(true);
    expect(gifts).toEqual([]);
    expect(lines).toContain('year.today.ticked');
    expect(lines).not.toContain('year.today.gift');
    expect(recentLog(p.id).filter((r) => r.type === 'event' && r.name === EVENTS.QUEST_DONE)).toHaveLength(1);
  });

  it('a session left early, or a plain session, ticks nothing', () => {
    let p = saveProfile(placed('Лена', 10, 5.5));
    setState({ profile: p, profiles: [p], meta: repo.meta() });
    const s = startSessionFor(p, 'hop', { year: 5, challenge: 'practice', items: 6 })!;
    p = finishSession(p, s, false).profile;
    p = answerAll(p, { year: 5 }).profile;
    expect(todayView(p, 5, Date.now())!.done).toBe(0);
  });

  it('completing today’s challenges counts as the daily quest for metrics and achievements', () => {
    let p = saveProfile(placed('Лена', 10, 5.5));
    setState({ profile: p, profiles: [p], meta: repo.meta() });
    const ctx = () => ({ profile: p, now: Date.now(), today: dayKey(Date.now()), log: recentLog(p.id), sessionId: null, graph: GRAPH, modesAvailable: 1, memo: new Map() });
    expect(evalCondition({ metric: 'quests.completed', gte: 1 }, ctx())).toBe(false);
    const set = todaysSet(p, 5, Date.now());
    p = answerAll(p, challengeOptions(set[0]!, p, 5, getMode('hop')!)).profile;
    // Play on after one challenge: that play is measured against the day's quest once the set is done.
    for (const c of set.slice(1)) p = solvePuzzle(p, 5, c.id).profile;
    p = answerAll(p, { year: 5 }).profile;
    expect(evalCondition({ metric: 'quests.completed', gte: 1 }, ctx())).toBe(true);
    const questAch: AchievementDef = { id: 'test.quest', category: 'persistence', bands: 'all', icon: 'star', on: ['session'], when: { metric: 'quests.completed', gte: 1 } };
    expect(evaluateAchievements([questAch], ctx(), 'session')).toEqual(['test.quest']);
    // The adult's free-choice measure reads the same event.
    expect(overview(p, recentLog(p.id), Date.now()).freeChoice).toBeGreaterThan(0);
  });

  it('logs the year on session records; the adult view counts sessions per year', () => {
    let p = saveProfile(placed('Лена', 10, 5.5));
    setState({ profile: p, profiles: [p], meta: repo.meta() });
    p = answerAll(p, { year: 5 }).profile;
    p = answerAll(p, { year: 5, quick: true }).profile;
    p = answerAll(p, { year: 4, quick: true }).profile;
    p = answerAll(p, {}).profile;
    const ends = recentLog(p.id).filter((r): r is SessionRecord => r.type === 'session' && r.phase === 'end');
    expect(ends.map((r) => r.year)).toEqual([5, 5, 4, null]);
    expect(recentLog(p.id).filter((r): r is SessionRecord => r.type === 'session' && r.phase === 'start').map((r) => r.year)).toEqual([5, 5, 4, null]);
    expect(yearsTried(recentLog(p.id))).toEqual([
      { year: 4, sessions: 1 },
      { year: 5, sessions: 2 },
    ]);
  });
});

describe('puzzles by year', () => {
  it('the static type table matches the puzzle track', () => {
    for (const b of ['A', 'B', 'C'] as BandId[]) expect(PUZZLE_TYPE_IDS[b]).toEqual(puzzleTypesFor(b).map((d) => d.id));
  });

  it('types come from the year’s band, kept to what the child’s band can play', () => {
    expect(puzzleTypesForYear(1, 'C', puzzleTypesFor)).toEqual(['pattern', 'balance']);
    expect(puzzleTypesForYear(7, 'A', puzzleTypesFor)).toEqual(['pattern', 'balance']);
    expect(puzzleTypesForYear(5, 'B', puzzleTypesFor)).toEqual(['pattern', 'balance', 'estimate', 'logic']);
    expect(puzzleTypesForYear(7, 'B', puzzleTypesFor)).toEqual(['pattern', 'balance', 'estimate', 'logic']);
    expect(puzzleTypesForYear(8, 'C', puzzleTypeIdsFor)).toEqual(['pattern', 'balance', 'estimate', 'logic', 'crypt']);
  });

  it('the level moves by a fixed step per year away from the child’s own (capped), the chip’s target never', () => {
    expect(puzzleLevelShift(5, 5)).toBe(0);
    expect(puzzleLevelShift(7, 5)).toBeCloseTo(2 * PUZZLE_YEAR_SHIFT);
    expect(puzzleLevelShift(2, 5)).toBeCloseTo(-3 * PUZZLE_YEAR_SHIFT);
    expect(puzzleLevelShift(9, 0)).toBeCloseTo(3 * PUZZLE_YEAR_SHIFT);
    const def = getPuzzleType('pattern');
    const base = startPuzzle(def, 'B', undefined, 0.75, T0, 77);
    const up = startPuzzle(def, 'B', undefined, 0.75, T0, 77, puzzleLevelShift(7, 5));
    expect(up.req).toBeCloseTo(base.req + 2 * PUZZLE_YEAR_SHIFT);
    expect(up.target).toBe(0.75);
    const p = placed('Марко', 9, 3.5);
    const started = beginPuzzle(p, 'pattern', false, 6);
    expect(started).toMatchObject({ year: 6, band: 'B', target: 0.75 });
  });
});

describe('guardrails: no countdowns, no time left, no loss framing', () => {
  const TIME_EN = /\bdays?\b|\bleft\b|remain|reset|expir|deadline|hurry|\bhours?\b|\bminutes?\b|countdown|\blast\b|\bmiss|\bends?\b|\bonly\b|limited|tomorrow|streak/i;
  const TIME_MK = /(?<!\p{L})(ден|дена|денови|час|часа|минути|рок)(?!\p{L})|останува|остануваат|истекува|брзај|последн|пропушт|ограничен|утре|низа/iu;

  it('no year-bar or challenge string speaks of time running out; placeholders are only counts, names and years', () => {
    for (const loc of allLocales()) {
      const keys = Object.keys(loc.messages).filter((k) => (k.startsWith('year.') && !k.startsWith('year.adult.')) || k === 'voice.today');
      expect(keys.length).toBeGreaterThan(25);
      for (const k of keys) {
        const msg = loc.messages[k]!;
        for (const arg of argumentNames(msg)) expect(['n', 'year', 'done', 'total', 'name', 'mode'], `${loc.id}:${k} {${arg}}`).toContain(arg);
        expect(msg, `${loc.id}:${k}`).not.toMatch(loc.id === 'mk' ? TIME_MK : TIME_EN);
      }
    }
  });

  it('the Macedonian labels use the school terms', () => {
    const mk = getLocale('mk').messages;
    expect(mk['year.today.title']).toBe('Денешни предизвици');
    expect(mk['profiles.title']).toBe('Кој игра?');
    expect(mk['profiles.add']).toBe('Нов играч');
    expect(mk['home.switch']).toBe('Смени играч');
    expect(mk['year.label']).toContain('одделение');
    expect(mk['year.label']).toContain('Предучилишно');
  });
});
