/**
 * Offline analytics for the adult dashboard. Pure functions of (profile, log)
 * so they are unit-testable and cannot leak anything off the device.
 */
import { daysUntilDue, retrievability } from '../core/engine/memory';
import type { LearnerModel } from '../core/engine/model';
import type { ItemRecord, LogRecord, SessionRecord } from '../core/log/types';
import { EVENTS } from '../core/log/types';
import type { Profile } from '../core/profile';
import type { SkillGraph } from '../core/skills/graph';
import { currentStreak } from '../core/streaks';
import { addDays, dayKey, dayStart } from '../core/time';
import type { SkillId } from '../core/types';

const DAY = 86_400_000;

const firstAttempts = (log: readonly LogRecord[]): ItemRecord[] =>
  log.filter((r): r is ItemRecord => r.type === 'item' && r.attempt === 1 && !r.timed);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface Overview {
  items30: number;
  accuracy30: number | null;
  medianSessionMin: number | null;
  streak: number;
  minutesByDay: Array<{ day: string; minutes: number }>;
  skillsByDay: Array<{ day: string; proficient: number; mastered: number }>;
  freeChoice: number | null;
}

export function overview(profile: Profile, log: readonly LogRecord[], now: number): Overview {
  const today = dayKey(now);
  const days = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
  const since = dayStart(days[0]!) - DAY / 2;
  const fa = firstAttempts(log).filter((r) => r.ts >= since);
  const ends = log.filter((r): r is SessionRecord => r.type === 'session' && r.phase === 'end' && r.ts >= since);
  const minutes = new Map<string, number>();
  for (const s of ends) minutes.set(dayKey(s.ts), (minutes.get(dayKey(s.ts)) ?? 0) + (s.durationMs ?? 0) / 60_000);

  const states = Object.values(profile.skills);
  const skillsByDay = days.map((day) => {
    const end = dayStart(day) + DAY / 2;
    return {
      day,
      proficient: states.filter((s) => s.proficientAt !== undefined && s.proficientAt <= end).length,
      mastered: states.filter((s) => s.masteredAt !== undefined && s.masteredAt <= end).length,
    };
  });

  // Free-choice: share of items answered after the day's quest was completed.
  let after = 0;
  let total = 0;
  for (const q of log) {
    if (q.type !== 'event' || q.name !== EVENTS.QUEST_DONE) continue;
    const d = dayKey(q.ts);
    const dayItems = firstAttempts(log).filter((r) => dayKey(r.ts) === d);
    total += dayItems.length;
    after += dayItems.filter((r) => r.ts > q.ts).length;
  }

  return {
    items30: fa.length,
    accuracy30: fa.length ? fa.filter((r) => r.correct && !r.hint).length / fa.length : null,
    medianSessionMin: median(ends.filter((s) => (s.items ?? 0) > 0).map((s) => (s.durationMs ?? 0) / 60_000)),
    streak: currentStreak(profile.streak, today),
    minutesByDay: days.map((day) => ({ day, minutes: Math.round((minutes.get(day) ?? 0) * 10) / 10 })),
    skillsByDay,
    freeChoice: total ? after / total : null,
  };
}

export interface SkillRow {
  id: SkillId;
  status: string;
  mu: number;
  sd: number;
  n: number;
  mastery: number;
  recall: number | null;
  dueDays: number | null;
  recent: { correct: number; n: number };
  medianLatency: number | null;
  bias: number | null;
}

export function skillRows(profile: Profile, log: readonly LogRecord[], now: number, model: LearnerModel, graph: SkillGraph): SkillRow[] {
  const fa = firstAttempts(log);
  return Object.entries(profile.skills)
    .filter(([id]) => graph.has(id))
    .map(([id, st]) => {
      const mine = fa.filter((r) => r.skill === id);
      const last = mine.slice(-20);
      return {
        id,
        status: st.status,
        mu: st.mu,
        sd: Math.sqrt(st.s2),
        n: st.n,
        mastery: model.masteryP(st, graph.get(id), now),
        recall: st.h !== undefined ? retrievability(st, now) : null,
        dueDays: daysUntilDue(st, now),
        recent: { correct: last.filter((r) => r.correct).length, n: last.length },
        medianLatency: median(mine.filter((r) => r.correct).map((r) => r.latency)),
        bias: mine.length >= 15 ? mine.reduce((s, r) => s + (r.correct ? 1 : 0) - r.p, 0) / mine.length : null,
      };
    })
    .sort((a, b) => graph.get(a.id).grade - graph.get(b.id).grade);
}

export interface CalBin {
  lo: number;
  hi: number;
  n: number;
  meanP: number;
  observed: number;
}

/**
 * Reliability diagram of first-attempt predictions. Skills are flagged when
 * |observed − predicted| > 0.15 over ≥ 15 attempts — that is where the
 * generator's difficulty mapping or the model needs recalibration.
 */
export function calibration(log: readonly LogRecord[]): { bins: CalBin[]; flagged: Array<{ skill: SkillId; p: number; o: number; n: number }> } {
  const fa = firstAttempts(log).filter((r) => r.source !== 'placement');
  const bins: CalBin[] = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, meanP: 0, observed: 0 }));
  for (const r of fa) {
    const b = bins[Math.min(9, Math.floor(r.p * 10))]!;
    b.n++;
    b.meanP += r.p;
    b.observed += r.correct ? 1 : 0;
  }
  for (const b of bins) if (b.n) {
    b.meanP /= b.n;
    b.observed /= b.n;
  }
  const bySkill = new Map<SkillId, { p: number; o: number; n: number }>();
  for (const r of fa) {
    const e = bySkill.get(r.skill) ?? { p: 0, o: 0, n: 0 };
    e.p += r.p;
    e.o += r.correct ? 1 : 0;
    e.n++;
    bySkill.set(r.skill, e);
  }
  const flagged = [...bySkill.entries()]
    .map(([skill, e]) => ({ skill, p: e.p / e.n, o: e.o / e.n, n: e.n }))
    .filter((x) => x.n >= 15 && Math.abs(x.o - x.p) > 0.15)
    .sort((a, b) => Math.abs(b.o - b.p) - Math.abs(a.o - a.p));
  return { bins: bins.filter((b) => b.n > 0), flagged };
}

export function misconceptions(log: readonly LogRecord[]): Array<{ code: string; n: number }> {
  const m = new Map<string, number>();
  for (const r of log) if (r.type === 'item' && r.mis) m.set(r.mis, (m.get(r.mis) ?? 0) + 1);
  return [...m.entries()].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n);
}

/** Skills whose error rate departs from what the model expected (|z| > 2, n ≥ 10). */
export function unusualErrors(log: readonly LogRecord[]): Array<{ skill: SkillId; expected: number; observed: number; n: number; z: number }> {
  const by = new Map<SkillId, ItemRecord[]>();
  for (const r of firstAttempts(log)) by.set(r.skill, [...(by.get(r.skill) ?? []), r]);
  const out: Array<{ skill: SkillId; expected: number; observed: number; n: number; z: number }> = [];
  for (const [skill, rs] of by) {
    if (rs.length < 10) continue;
    const expected = rs.reduce((s, r) => s + (1 - r.p), 0) / rs.length;
    const observed = rs.filter((r) => !r.correct).length / rs.length;
    const variance = rs.reduce((s, r) => s + r.p * (1 - r.p), 0) / rs.length ** 2;
    const z = (observed - expected) / Math.sqrt(Math.max(variance, 1e-6));
    if (Math.abs(z) > 2) out.push({ skill, expected, observed, n: rs.length, z });
  }
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}
