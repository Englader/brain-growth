/**
 * Seasons (plan step 10): the pure calendar and seasonal cosmetics, then the
 * integration: the drop pool, cosmetics that persist, the seasonal weekly
 * theme, the "played during" secret achievements, the per-child switch, the
 * decoration's contrast and the season strings (no FOMO, no countdowns).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import '../src/modes';
import { finishSession, recordAnswer, startSessionFor } from '../src/app/actions';
import { saveProfile } from '../src/app/persist';
import { seasonalDropDate, seasonNow, seasonOn } from '../src/app/seasonActions';
import { repo, testOverrides } from '../src/app/services';
import { setState } from '../src/app/store';
import { pinWeeklyFor, weeklyBoostFor, weeklyStateFor, weeklyView } from '../src/app/weeklyActions';
import { voiceLine } from '../src/audio/voiceScript';
import { ACHIEVEMENTS, evaluateAchievements, getMetric, validateAchievements } from '../src/core/achievements';
import { glickoElo } from '../src/core/engine/glicko';
import { replay } from '../src/core/engine/replay';
import { FLAGS } from '../src/core/flags';
import type { LogRecord, SessionRecord } from '../src/core/log/types';
import { EVENTS } from '../src/core/log/types';
import { createProfile, type Profile } from '../src/core/profile';
import { key } from '../src/core/rational';
import { COSMETICS, getCosmetic } from '../src/core/rewards/cosmetics';
import { pickCosmetic, rollDrop, SEASON_DROP_BOOST } from '../src/core/rewards/drops';
import { createRng } from '../src/core/rng';
import {
  activeSeasons,
  getSeasonCosmetic,
  inSeasonDrop,
  orthodoxEaster,
  SEASON_COSMETICS,
  SEASON_FLAG,
  SEASON_IDS,
  seasonalDropPool,
  seasonFor,
  seasonForWeek,
  seasonGreetingKey,
  seasonKey,
  seasonNameKey,
  seasonWeekDescKey,
  seasonWeekKey,
  seasonWindow,
  shownInWardrobe,
  toDay,
  weekThursday,
} from '../src/core/seasons';
import { GRAPH } from '../src/core/skills';
import { addDays, dayKey, weekKey } from '../src/core/time';
import type { BandId } from '../src/core/types';
import {
  getWeeklyTheme,
  MIXED_THEME,
  rewardFor,
  SEASONAL_THEMES,
  seasonalThemeFor,
  themeFor,
  weeklyThemeDescKey,
  weeklyThemeNameKey,
  WEEKLY_THEMES,
} from '../src/core/weekly';
import { mergeProfiles } from '../src/data/merge';
import { argumentNames } from '../src/i18n/format';
import { allLocales, getLocale } from '../src/i18n/locales';

describe('orthodoxEaster', () => {
  it('matches the known dates', () => {
    expect(orthodoxEaster(2025)).toBe('2025-04-20');
    expect(orthodoxEaster(2026)).toBe('2026-04-12');
    expect(orthodoxEaster(2027)).toBe('2027-05-02');
  });

  it('matches more published years', () => {
    const known: Record<number, string> = {
      2016: '2016-05-01',
      2017: '2017-04-16',
      2018: '2018-04-08',
      2019: '2019-04-28',
      2020: '2020-04-19',
      2021: '2021-05-02',
      2022: '2022-04-24',
      2023: '2023-04-16',
      2024: '2024-05-05',
      2028: '2028-04-16',
      2029: '2029-04-08',
      2030: '2030-04-28',
      2031: '2031-04-13',
    };
    for (const [y, d] of Object.entries(known)) expect(orthodoxEaster(Number(y)), y).toBe(d);
  });

  it('is always a Sunday between April 4 and May 8 (1900–2099)', () => {
    for (let y = 1900; y <= 2099; y++) {
      const d = orthodoxEaster(y);
      expect(new Date(`${d}T12:00:00Z`).getUTCDay(), d).toBe(0);
      expect(d.slice(5) >= '04-04' && d.slice(5) <= '05-08', d).toBe(true);
    }
  });

  it('rejects years before the Gregorian calendar', () => {
    expect(() => orthodoxEaster(1500)).toThrow(RangeError);
  });
});

describe('season windows', () => {
  it('New Year runs Dec 20 – Jan 10 across the year boundary', () => {
    expect(activeSeasons('2026-12-19')).toEqual([]);
    for (const d of ['2026-12-20', '2026-12-24', '2026-12-31', '2027-01-01', '2027-01-07', '2027-01-10']) {
      expect(activeSeasons(d), d).toEqual(['newYear']);
    }
    expect(activeSeasons('2027-01-11')).toEqual([]);
    expect(seasonWindow('newYear', 2027)).toEqual({ id: 'newYear', year: 2027, start: '2026-12-20', end: '2027-01-10' });
  });

  it('one New Year occurrence has one key on both sides of Jan 1', () => {
    expect(seasonKey('newYear', '2026-12-24')).toBe('newYear-2027');
    expect(seasonKey('newYear', '2027-01-05')).toBe('newYear-2027');
    expect(seasonKey('newYear', '2027-12-24')).toBe('newYear-2028');
    expect(seasonKey('newYear', '2027-06-01')).toBeNull();
  });

  it('Easter runs 7 days either side of Orthodox Easter, boundary days included', () => {
    // 2026: Easter Sunday April 12.
    expect(activeSeasons('2026-04-04')).toEqual([]);
    expect(activeSeasons('2026-04-05')).toEqual(['easter']);
    expect(activeSeasons('2026-04-12')).toEqual(['easter']);
    expect(activeSeasons('2026-04-19')).toEqual(['easter']);
    expect(activeSeasons('2026-04-20')).toEqual([]);
    // 2027: Easter May 2, so the window crosses into May.
    expect(seasonWindow('easter', 2027)).toEqual({ id: 'easter', year: 2027, start: '2027-04-25', end: '2027-05-09' });
    expect(seasonFor('2027-05-09')).toBe('easter');
    expect(seasonFor('2027-05-10')).toBeNull();
    expect(seasonKey('easter', '2027-04-30')).toBe('easter-2027');
  });

  it('seasons come back every year and never overlap', () => {
    for (let y = 2026; y <= 2060; y++) {
      expect(seasonFor(`${y}-12-24`)).toBe('newYear');
      expect(seasonFor(`${y}-01-01`)).toBe('newYear');
      expect(seasonFor(orthodoxEaster(y))).toBe('easter');
      expect(seasonFor(`${y}-07-15`)).toBeNull();
    }
    for (let d = '2026-01-01'; d <= '2028-12-31'; d = addDays(d, 1)) expect(activeSeasons(d).length).toBeLessThanOrEqual(1);
  });

  it('accepts timestamps (local calendar day) and rejects malformed days', () => {
    expect(seasonFor(new Date(2026, 11, 20, 0, 5).getTime())).toBe('newYear');
    expect(seasonFor(new Date(2026, 11, 19, 23, 55).getTime())).toBeNull();
    expect(() => toDay('2026-02-30')).toThrow(RangeError);
    expect(() => toDay('24.12.2026')).toThrow(RangeError);
  });

  it('a whole ISO week belongs to one season, judged on its Thursday', () => {
    expect(weekThursday('2026-W01')).toBe('2026-01-01');
    expect(weekThursday('2026-W53')).toBe('2026-12-31');
    for (let d = '2026-01-01'; d <= '2027-12-31'; d = addDays(d, 7)) {
      const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
      const wk = weekKey(new Date(y, m - 1, dd, 12).getTime());
      const th = weekThursday(wk);
      expect(weekKey(new Date(Number(th.slice(0, 4)), Number(th.slice(5, 7)) - 1, Number(th.slice(8)), 12).getTime())).toBe(wk);
    }
    expect(seasonForWeek(weekKey(new Date(2026, 11, 24, 12).getTime()))).toBe('newYear');
    expect(seasonForWeek('2026-W15')).toBe('easter'); // Mon Apr 6 – Sun Apr 12
    expect(seasonForWeek('2026-W30')).toBeNull();
  });

  it('exposes season names as keys, never text', () => {
    expect(SEASON_IDS.map(seasonNameKey)).toEqual(['season.newYear.name', 'season.easter.name']);
  });
});

describe('seasonal cosmetics', () => {
  it('are season.* ids in the cosmetics shape, unique, and registered in the season slot', () => {
    const ids = SEASON_COSMETICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of SEASON_COSMETICS) {
      expect(c.id).toMatch(new RegExp(`^season\\.${c.season}\\.`));
      expect(c.source).toBe('season');
      expect([1, 2, 3]).toContain(c.rarity);
      expect(c.bands).toEqual(['hat', 'pad', 'color'].includes(c.slot) ? ['A', 'B'] : ['C']);
      expect(COSMETICS.filter((d) => d.id === c.id)).toEqual([c]);
    }
  });

  it('every season has something for every band', () => {
    for (const s of SEASON_IDS) {
      for (const b of ['A', 'B', 'C'] as BandId[]) {
        expect(SEASON_COSMETICS.some((c) => c.season === s && c.bands.includes(b)), `${s}/${b}`).toBe(true);
      }
    }
  });

  it('drop only in season', () => {
    expect(seasonalDropPool('2026-07-01', 'A', [])).toEqual([]);
    expect(seasonalDropPool('2026-12-24', 'A', []).every((c) => c.season === 'newYear')).toBe(true);
    expect(seasonalDropPool('2026-12-24', 'A', []).length).toBeGreaterThan(0);
    expect(seasonalDropPool('2026-04-12', 'C', []).map((c) => c.id)).toEqual(['season.easter.theme', 'season.easter.title']);
    const hat = getSeasonCosmetic('season.newYear.hat')!;
    expect(inSeasonDrop(hat, '2026-12-24')).toBe(true);
    expect(inSeasonDrop(hat, '2027-01-11')).toBe(false);
    expect(inSeasonDrop(hat, '2027-04-12')).toBe(false);
    // Ordinary cosmetics are never affected by the calendar.
    for (const c of COSMETICS) expect(inSeasonDrop(c, '2026-07-01')).toBe(c.source !== 'season');
  });

  it('are never offered twice, persist after the season, and return next year', () => {
    const owned = ['season.newYear.hat'];
    expect(seasonalDropPool('2026-12-24', 'B', owned).map((c) => c.id)).not.toContain('season.newYear.hat');
    // Out of season, the owned hat is still a known cosmetic (nothing removes it).
    expect(getSeasonCosmetic('season.newYear.hat')).toBeDefined();
    const pool = (d: string): string[] => seasonalDropPool(d, 'B', []).map((c) => c.id);
    expect(pool('2027-12-24')).toEqual(pool('2026-12-24'));
    expect(pool(orthodoxEaster(2030))).toEqual(pool(orthodoxEaster(2026)));
  });
});

// ── integration ────────────────────────────────────────────────────────────
const BANDS: BandId[] = ['A', 'B', 'C'];
const at = (iso: string): number => new Date(`${iso}T10:00:00`).getTime();
const XMAS_EVE = at('2026-12-24');
const EASTER_2027 = at('2027-05-02');
const SUMMER = at('2027-07-15');

/** A child placed at grade `g` (skills rebuilt from a synthetic placement, like `__hopa.seed`). */
function placed(name: string, age: number, g: number, t: number, flags: Record<string, boolean> = {}): Profile {
  const base = createProfile({ name, age, locale: 'mk', avatar: 'color.green' }, t - 60_000);
  const skills = replay({ graph: GRAPH, model: glickoElo }, [{ type: 'event', ts: t - 30_000, sid: null, name: EVENTS.PLACEMENT_DONE, data: { g, sd: 0.3 } }]);
  return { ...base, skills, flags, placement: { done: true, state: null, g, sd: 0.3 } };
}

describe('seasonal drops (drops.ts through inSeasonDrop)', () => {
  const draw = (band: BandId, date: number | undefined, n = 3000, owned: string[] = []): string[] => {
    const rng = createRng(7);
    return Array.from({ length: n }, () => pickCosmetic(owned, band, rng, date)?.id ?? 'none');
  };

  it('never drops a seasonal cosmetic out of season, or without a date (seasonal touches off)', () => {
    for (const band of BANDS) {
      for (const date of [SUMMER, at('2026-12-19'), at('2027-01-11'), undefined]) {
        expect(draw(band, date).filter((id) => id.startsWith('season.')), `${band} ${date}`).toEqual([]);
      }
      const rng = createRng(3);
      for (let i = 0; i < 2000; i++) expect(rollDrop(40, [], band, rng, SUMMER).dropped?.source ?? 'drop').toBe('drop');
    }
  });

  it("in season, only that season's items join, for the right bands, and noticeably often", () => {
    for (const band of BANDS) {
      const ny = draw(band, XMAS_EVE).filter((id) => id.startsWith('season.'));
      expect(ny.length / 3000, band).toBeGreaterThan(0.2);
      expect(ny.every((id) => id.startsWith('season.newYear.') && getCosmetic(id)!.bands.includes(band))).toBe(true);
      const ea = draw(band, EASTER_2027).filter((id) => id.startsWith('season.'));
      expect(ea.length).toBeGreaterThan(0);
      expect(ea.every((id) => id.startsWith('season.easter.'))).toBe(true);
    }
    expect(SEASON_DROP_BOOST).toBeGreaterThan(1);
    // Weekly set pieces still never drop, in season or not.
    expect(draw('B', XMAS_EVE).some((id) => id.startsWith('weekly.'))).toBe(false);
  });

  it('an owned seasonal item is never offered again, and the season comes back the next year', () => {
    const owned = SEASON_COSMETICS.filter((c) => c.season === 'newYear').map((c) => c.id);
    expect(draw('A', XMAS_EVE, 2000, owned).filter((id) => id.startsWith('season.'))).toEqual([]);
    expect(draw('A', at('2027-12-28')).filter((id) => id.startsWith('season.')).length).toBeGreaterThan(0);
  });
});

describe('seasonal cosmetics persist after the season', () => {
  const hat = getCosmetic('season.newYear.hat')!;

  it('stay registered, shown and equippable once owned; unowned ones show only in season', () => {
    expect(hat.value).toBe('winterHat');
    expect(getCosmetic('season.easter.hat')!.value).toBe('flowerCrown');
    expect(shownInWardrobe(hat, true, SUMMER)).toBe(true);
    expect(shownInWardrobe(hat, true, null)).toBe(true);
    expect(shownInWardrobe(hat, false, XMAS_EVE)).toBe(true);
    expect(shownInWardrobe(hat, false, SUMMER)).toBe(false); // no teaser for next year
    expect(shownInWardrobe(hat, false, null)).toBe(false);
    for (const c of COSMETICS.filter((d) => d.source !== 'season')) expect(shownInWardrobe(c, false, SUMMER)).toBe(true);
  });

  it('survive a merge between devices', () => {
    const a = placed('Ана', 6, 2.4, SUMMER);
    const phone = { ...a, cosmetics: { owned: [...a.cosmetics.owned, 'season.newYear.hat'], equipped: { hat: 'season.newYear.hat' } }, updatedAt: SUMMER + 5 };
    const tablet = { ...a, updatedAt: SUMMER + 1 };
    expect(mergeProfiles(phone, tablet).cosmetics.owned).toContain('season.newYear.hat');
    expect(mergeProfiles(tablet, phone).cosmetics.owned).toContain('season.newYear.hat');
  });

  it('seasonal pads keep the pad number readable (a patterned rim around a light centre)', () => {
    for (const c of SEASON_COSMETICS.filter((d) => d.slot === 'pad')) expect(c.value).toMatch(/gradient\(.*#(bae6fd|fef9c3)$/);
  });
});

describe('seasonal weekly theme', () => {
  afterEach(() => {
    testOverrides.clockOffsetMs = 0;
  });

  it('overrides the ordinary theme for whole ISO weeks in season, for every band', () => {
    expect(seasonalThemeFor(weekKey(XMAS_EVE))?.id).toBe('newYear');
    expect(seasonalThemeFor(weekKey(at('2027-01-06')))?.id).toBe('newYear');
    expect(seasonalThemeFor(weekKey(EASTER_2027))?.id).toBe('easter');
    expect(seasonalThemeFor('2026-W40')).toBeNull();
    for (const t of SEASONAL_THEMES) {
      expect(t.skills).toEqual([]); // every skill counts
      expect(t.bands).toEqual(BANDS);
      expect(getWeeklyTheme(t.id)).toBe(t);
      expect(WEEKLY_THEMES).not.toContain(t);
      for (const b of BANDS) {
        const reward = getCosmetic(rewardFor(t, b)!)!;
        expect(reward.source).toBe('season');
        expect(reward.id.startsWith(`season.${t.season}.`)).toBe(true);
        expect(reward.bands).toContain(b);
      }
    }
  });

  it('the app pins the seasonal theme for siblings in season, and an ordinary one otherwise or when switched off', () => {
    const ana = placed('Ана', 6, 2.4, XMAS_EVE);
    const marko = placed('Марко', 9, 3.5, XMAS_EVE);
    const stefan = placed('Стефан', 13, 7, XMAS_EVE);
    for (const p of [ana, marko, stefan]) expect(pinWeeklyFor(p, XMAS_EVE).weekly?.theme).toBe('newYear');
    expect(pinWeeklyFor(ana, EASTER_2027).weekly?.theme).toBe('easter');
    expect(getWeeklyTheme(pinWeeklyFor(ana, SUMMER).weekly!.theme)?.season).toBeUndefined();
    const off = { ...marko, flags: { [SEASON_FLAG]: false } };
    expect(getWeeklyTheme(pinWeeklyFor(off, XMAS_EVE).weekly!.theme)?.season).toBeUndefined();
    // Switched off mid-week after the seasonal pin: an ordinary theme, same week and rewarded flag.
    const pinned = pinWeeklyFor(marko, XMAS_EVE);
    const repinned = weeklyStateFor({ ...pinned, flags: { [SEASON_FLAG]: false }, weekly: { ...pinned.weekly!, rewarded: true } }, XMAS_EVE);
    expect(repinned).toMatchObject({ week: weekKey(XMAS_EVE), rewarded: true });
    expect(getWeeklyTheme(repinned.theme)?.season).toBeUndefined();
    // An ordinary theme pinned earlier the same week is never moved under the child's feet.
    const early = { ...marko, weekly: { week: weekKey(XMAS_EVE), theme: 'tables', rewarded: false } };
    expect(pinWeeklyFor(early, XMAS_EVE).weekly?.theme).toBe('tables');
    // No boost for a seasonal week (every skill counts); its names come from the season block.
    expect(weeklyBoostFor(marko, 'newYear')).toBeUndefined();
    const nt = getWeeklyTheme('newYear')!;
    expect(weeklyThemeNameKey(nt)).toBe(seasonWeekKey('newYear'));
    expect(weeklyThemeDescKey(nt)).toBe(seasonWeekDescKey('newYear'));
    // The pure ordinary picker is untouched by seasons.
    expect(themeFor(weekKey(XMAS_EVE), 'B', ['md.mult.facts']).season).toBeUndefined();
    expect(themeFor(weekKey(XMAS_EVE), 'A', []).id).toBe(MIXED_THEME.id);
  });

  it('six sessions in the New Year week: stones light, the winter hat arrives once, the secret trophy unlocks once', () => {
    testOverrides.clockOffsetMs = XMAS_EVE - Date.now();
    repo.init();
    let p = saveProfile(pinWeeklyFor(placed('Марко', 9, 3.5, XMAS_EVE), XMAS_EVE));
    setState({ profile: p, profiles: [p], session: null, meta: repo.meta() });
    const view = weeklyView(p, XMAS_EVE)!;
    expect(view.theme.id).toBe('newYear');
    expect(view.reward).toBe('season.newYear.hat');
    const trophies: string[] = [];
    let granted = 0;
    for (let i = 0; i < 6; i++) {
      let s = startSessionFor(p, 'hop', { theme: 'newYear' })!;
      for (let pi = s.engine.next(); pi; pi = s.engine.next()) {
        const r = recordAnswer(p, s, pi, { kind: 'typed', raw: key(pi.item.answer.value) }, { latencyMs: 2500, hint: false, input: 'typed', hops: 0 });
        p = r.profile;
        s = r.session;
      }
      const done = finishSession(p, s, true);
      p = done.profile;
      trophies.push(...done.result.achievements);
      if (done.result.extras?.some((e) => e.key === 'weekly.reward')) {
        // The hat, or a surprise if a seasonal drop already brought the hat this week.
        expect(done.result.gifts.length).toBeGreaterThan(0);
        granted++;
      }
    }
    expect(granted).toBe(1);
    // Either way the child has the winter hat exactly once.
    expect(p.rewards.pending.filter((id) => id === 'season.newYear.hat')).toHaveLength(1);
    expect(p.weekly).toMatchObject({ theme: 'newYear', rewarded: true });
    expect(trophies.filter((id) => id === 'season.newYear')).toHaveLength(1);
    expect(trophies).not.toContain('season.easter');
  });
});

describe('"played during" achievements', () => {
  const end = (d: string, over: Partial<SessionRecord> = {}): SessionRecord => ({
    type: 'session', ts: at(d), sid: `s${d}`, phase: 'end', mode: 'hop', band: 'B', locale: 'mk', opts: {},
    items: 6, firstCorrect: 4, durationMs: 180_000, completed: true, lastCorrect: true, exitIndex: null, ...over,
  });
  const ctx = (log: LogRecord[], flags: Record<string, boolean> = {}) => ({
    profile: placed('Марко', 9, 3.5, SUMMER, flags), now: SUMMER, today: dayKey(SUMMER), log, sessionId: null, graph: GRAPH, modesAvailable: 2, memo: new Map<string, unknown>(),
  });

  it('are secret discoveries on an exploration metric; the catalogue stays valid', () => {
    expect(validateAchievements(ACHIEVEMENTS)).toEqual([]);
    for (const id of ['season.newYear', 'season.easter']) {
      const a = ACHIEVEMENTS.find((x) => x.id === id)!;
      expect(a).toMatchObject({ category: 'discovery', secret: true, bands: 'all' });
      expect(a.on).toContain('session');
    }
    expect(getMetric('season.played')?.kind).toBe('exploration');
  });

  it('count days played in the season (any year), right or wrong; zero when switched off', () => {
    const m = getMetric('season.played')!;
    const log: LogRecord[] = [
      end('2026-12-24'),
      end('2026-12-24', { sid: 'again' }), // the same day counts once
      end('2027-01-10', { firstCorrect: 0 }), // right or wrong
      end('2027-01-11'), // the day after the season
      end('2026-12-26', { items: 0, completed: false }), // opened and left: not played
      end('2027-04-25', { completed: false, items: 2 }), // left early, but played: counts
    ];
    expect(m.compute(ctx(log), { season: 'newYear' })).toBe(2);
    expect(m.compute(ctx(log), { season: 'easter' })).toBe(1);
    expect(m.compute(ctx(log, { [SEASON_FLAG]: false }), { season: 'newYear' })).toBe(0);
    expect(evaluateAchievements(ACHIEVEMENTS, ctx(log), 'session')).toEqual(expect.arrayContaining(['season.newYear', 'season.easter']));
    expect(evaluateAchievements(ACHIEVEMENTS, ctx([end('2027-07-01')]), 'session').filter((id) => id.startsWith('season.'))).toEqual([]);
  });
});

describe('the per-child switch', () => {
  it('is a profile flag, on by default, labelled in the season block', () => {
    expect(FLAGS.find((f) => f.id === SEASON_FLAG)).toMatchObject({ scope: 'profile', default: true, labelKey: 'season.flag' });
    const p = placed('Ана', 6, 2.4, XMAS_EVE);
    expect(seasonOn(p)).toBe(true);
    expect(seasonNow(p, XMAS_EVE)).toBe('newYear');
    expect(seasonNow(null, EASTER_2027)).toBe('easter');
    expect(seasonNow(p, SUMMER)).toBeNull();
    expect(seasonalDropDate(p, XMAS_EVE)).toBe(XMAS_EVE);
    const off = { ...p, flags: { [SEASON_FLAG]: false } };
    expect(seasonOn(off)).toBe(false);
    expect(seasonNow(off, XMAS_EVE)).toBeNull();
    expect(seasonalDropDate(off, XMAS_EVE)).toBeUndefined();
  });
});

describe('seasonal decoration (app.css)', () => {
  const css = readFileSync(resolve(__dirname, '../src/styles/app.css'), 'utf8');
  const hex = (h: string): number[] => {
    const x = h.length === 4 ? [...h.slice(1)].map((c) => c + c).join('') : h.slice(1);
    return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
  };
  const lum = (rgb: number[]): number => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: number[], b: number[]): number => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
    return (x + 0.05) / (y + 0.05);
  };
  const block = (sel: string): string => {
    const i = css.indexOf(`${sel} {`);
    expect(i, sel).toBeGreaterThanOrEqual(0);
    return css.slice(i, css.indexOf('}', i));
  };
  const token = (b: string, name: string): string => new RegExp(`${name}:\\s*(#[0-9a-f]{3,6})\\b`).exec(b)![1]!;
  const tile = (name: string): string => decodeURIComponent(new RegExp(`--season-${name}: url\\("data:image/svg\\+xml,([^"]+)"\\)`).exec(css)![1]!);
  const opacity = (sel: string): number => Number(/--season-scatter-opacity: ([0-9.]+)/.exec(block(sel))![1]);

  it('the snow and blossom layers keep body and muted text at 4.5:1 or better on the light and dark child themes', () => {
    const base = block('.app,\n.screen[data-theme]');
    const light = opacity('.app[data-season]');
    const themes: Record<string, { bg: string; ink: string; muted: string; opacity: number }> = {
      lagoon: { bg: token(base, '--bg'), ink: token(base, '--ink'), muted: token(base, '--muted'), opacity: light },
      meadow: { bg: token(block("[data-theme='meadow']"), '--bg'), ink: token(block("[data-theme='meadow']"), '--ink'), muted: token(block("[data-theme='meadow']"), '--muted'), opacity: light },
      slate: { bg: token(block("[data-theme='slate']"), '--bg'), ink: token(block("[data-theme='slate']"), '--ink'), muted: token(block("[data-theme='slate']"), '--muted'), opacity: opacity(".app[data-season][data-theme='slate']") },
    };
    for (const layer of ['snow', 'meadow']) {
      const colours = [...new Set(tile(layer).match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/g))];
      expect(colours.length, layer).toBeGreaterThan(1);
      for (const [name, th] of Object.entries(themes)) {
        const bg = hex(th.bg);
        for (const c of colours) {
          const mixed = hex(c).map((v, i) => th.opacity * v + (1 - th.opacity) * bg[i]!);
          for (const text of [th.ink, th.muted]) expect(contrast(hex(text), mixed), `${layer} ${c} on ${name}, text ${text}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('snow falls only when motion is welcome, and the top strip gets room of its own', () => {
    const animated = [...css.matchAll(/animation: season-snow/g)].length;
    expect(animated).toBe(1);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.app\[data-season='newYear'\]::before \{\s*animation: season-snow/);
    expect(block('.app[data-season] > .screen')).toMatch(/padding-top: max\(26px/);
  });
});

describe('season strings (no FOMO, no countdowns)', () => {
  const FOMO_EN = /limited|last chance|only today|hurry|countdown|\bdays?\b|\bleft\b|remain|expir|\bends?\b|\blast\b|\bonly\b|\bmiss/i;
  const FOMO_MK = /ограничен|последна шанса|само денес|само уште|брзај|истекува|останува|остануваат|пропушт|последн|(?<!\p{L})(ден|дена|денови|час|часа|рок)(?!\p{L})/iu;
  const seasonKeys = (msgs: Record<string, string>): string[] =>
    Object.keys(msgs).filter((k) => ['season.', 'cos.season.', 'ach.season.', 'voice.season.'].some((pre) => k.startsWith(pre)));

  it('no season string speaks of scarcity or time running out, and none takes a time or days placeholder', () => {
    for (const loc of allLocales()) {
      const keys = seasonKeys(loc.messages);
      expect(keys.length, loc.id).toBeGreaterThanOrEqual(25);
      for (const k of keys) {
        const msg = loc.messages[k]!;
        expect(argumentNames(msg), `${loc.id}:${k}`).toEqual([]);
        expect(msg, `${loc.id}:${k}`).not.toMatch(loc.id === 'mk' ? FOMO_MK : FOMO_EN);
      }
    }
    // The guards catch what they should.
    for (const bad of ['Limited edition!', 'Last chance', 'Only today', '3 days left']) expect(bad).toMatch(FOMO_EN);
    for (const bad of ['Ограничено издание', 'Последна шанса!', 'Само денес', 'Уште 3 дена']) expect(bad).toMatch(FOMO_MK);
  });

  it('every season, cosmetic, achievement, voice line and the switch has both strings', () => {
    const need = [
      'season.flag',
      ...SEASON_IDS.flatMap((id) => [seasonNameKey(id), seasonWeekKey(id), seasonWeekDescKey(id), seasonGreetingKey(id), `ach.season.${id}.name`, `ach.season.${id}.desc`]),
      ...SEASON_COSMETICS.map((c) => `cos.${c.id}`),
    ];
    for (const loc of allLocales()) for (const k of need) expect(loc.messages[k], `${loc.id}:${k}`).toBeTruthy();
    for (const id of SEASON_IDS) {
      expect(getLocale('en').messages[`ach.season.${id}.hint`]).toBeUndefined(); // secret: no hint
      expect(voiceLine(seasonGreetingKey(id), 'mk')).toEqual([seasonGreetingKey(id)]);
    }
  });
});
