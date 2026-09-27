import { describe, expect, it } from 'vitest';
import { COSMETICS } from '../src/core/rewards/cosmetics';
import {
  activeSeasons,
  getSeasonCosmetic,
  inSeasonDrop,
  orthodoxEaster,
  SEASON_COSMETICS,
  SEASON_IDS,
  seasonalDropPool,
  seasonFor,
  seasonForWeek,
  seasonKey,
  seasonNameKey,
  seasonWindow,
  toDay,
  weekThursday,
} from '../src/core/seasons';
import { addDays, weekKey } from '../src/core/time';
import type { BandId } from '../src/core/types';

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
  it('are season.* ids in the cosmetics shape, unique, and new', () => {
    const ids = SEASON_COSMETICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of SEASON_COSMETICS) {
      expect(c.id).toMatch(new RegExp(`^season\\.${c.season}\\.`));
      expect(c.source).toBe('season');
      expect([1, 2, 3]).toContain(c.rarity);
      expect(c.bands).toEqual(['hat', 'pad', 'color'].includes(c.slot) ? ['A', 'B'] : ['C']);
      expect(COSMETICS.some((d) => d.id === c.id)).toBe(false);
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
    for (const c of COSMETICS) expect(inSeasonDrop(c, '2026-07-01')).toBe(true);
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
