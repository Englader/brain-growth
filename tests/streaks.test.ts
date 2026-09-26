import { describe, expect, it } from 'vitest';
import { applyFreezes, currentStreak, emptyStreak, freezesLeft, mergeStreaks, recordActiveDay, streakView } from '../src/core/streaks';

const days = (...ds: string[]): ReturnType<typeof emptyStreak> => ds.reduce(recordActiveDay, emptyStreak());

describe('streaks', () => {
  it('counts consecutive active days and stays alive until the day ends', () => {
    const s = days('2026-09-01', '2026-09-02', '2026-09-03');
    expect(currentStreak(s, '2026-09-03')).toBe(3);
    expect(currentStreak(s, '2026-09-04')).toBe(3); // not played yet today: still alive
    expect(currentStreak(s, '2026-09-06')).toBe(0);
  });

  it('bridges a missed day with an automatic freeze (frozen days do not add length)', () => {
    const s = days('2026-09-01', '2026-09-02', '2026-09-04');
    expect(s.freezeDays).toEqual(['2026-09-03']);
    expect(currentStreak(s, '2026-09-04')).toBe(3);
    expect(freezesLeft(s, '2026-09-04')).toBe(1);
  });

  it('never wastes freezes on a gap it cannot cover', () => {
    const s = days('2026-09-01', '2026-09-05');
    expect(s.freezeDays).toEqual([]);
    expect(currentStreak(s, '2026-09-05')).toBe(1);
    expect(freezesLeft(s, '2026-09-05')).toBe(2);
  });

  it('grants two freezes per calendar month', () => {
    let s = days('2026-09-01', '2026-09-03', '2026-09-05');
    expect(freezesLeft(s, '2026-09-05')).toBe(0);
    s = recordActiveDay(s, '2026-09-07'); // no freeze left → streak restarts
    expect(currentStreak(s, '2026-09-07')).toBe(1);
    s = days('2026-09-29', '2026-10-01'); // gap day in September, uses September's allowance
    expect(s.freezeDays).toEqual(['2026-09-30']);
    expect(freezesLeft(s, '2026-10-01')).toBe(2);
  });

  it('applyFreezes is idempotent', () => {
    const s = days('2026-09-01');
    const a = applyFreezes(s, '2026-09-03').state;
    expect(applyFreezes(a, '2026-09-03').state).toEqual(a);
  });

  it('tracks the longest streak and frames the first week as establishment', () => {
    const s = days('2026-09-01', '2026-09-02');
    const v = streakView(s, '2026-09-02');
    expect(v.establishing).toBe(true);
    expect(v.calendar).toHaveLength(14);
    const week = days(...Array.from({ length: 7 }, (_, i) => `2026-09-0${i + 1}`));
    expect(streakView(week, '2026-09-07').establishing).toBe(false);
    expect(week.longest).toBe(7);
  });

  it('merging devices is a union: it can only lengthen a streak', () => {
    const a = days('2026-09-01', '2026-09-02');
    const b = days('2026-09-03', '2026-09-04');
    expect(currentStreak(mergeStreaks(a, b), '2026-09-04')).toBe(4);
  });
});
