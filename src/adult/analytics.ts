/**
 * Offline analytics for the adult dashboard. Pure functions of (profile, log)
 * so they are unit-testable and cannot leak anything off the device.
 */
import { daysUntilDue, retrievability } from '../core/engine/memory';
import type { LearnerModel } from '../core/engine/model';
import { hintTierOf } from '../core/engine/observe';
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
  const flagged = calibrationBias(log, Infinity)
    .filter((x) => Math.abs(x.bias) > 0.15)
    .map(({ skill, p, o, n }) => ({ skill, p, o, n }));
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

// ── pilot readout (DESIGN §5.2, I-1) ───────────────────────────────────────

/** Top skills by |observed − predicted| first-try success (≥ `minN` first attempts, placement excluded). */
export function calibrationBias(log: readonly LogRecord[], top = 3, minN = 15): Array<{ skill: SkillId; p: number; o: number; n: number; bias: number }> {
  const by = new Map<SkillId, { p: number; o: number; n: number }>();
  for (const r of firstAttempts(log)) {
    if (r.source === 'placement') continue;
    const e = by.get(r.skill) ?? { p: 0, o: 0, n: 0 };
    e.p += r.p;
    e.o += r.correct ? 1 : 0;
    e.n++;
    by.set(r.skill, e);
  }
  return [...by.entries()]
    .filter(([, e]) => e.n >= minN)
    .map(([skill, e]) => ({ skill, p: e.p / e.n, o: e.o / e.n, n: e.n, bias: (e.o - e.p) / e.n }))
    .sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias))
    .slice(0, top);
}

export interface ExitStats {
  /** Sessions left early after at least one answer. */
  exits: number;
  /** …of which the last answer was wrong (P-4: "exits cluster right after errors"). */
  afterError: number;
  share: number | null;
  /** Median number of items shown when the child quit. */
  medianIndex: number | null;
}

/**
 * Early exits and how many came right after a wrong answer. Uses the session
 * record's lastCorrect; for records written before it existed, the last item
 * record of that session.
 */
export function exitsAfterError(log: readonly LogRecord[]): ExitStats {
  const lastBySid = new Map<string, boolean>();
  for (const r of log) if (r.type === 'item') lastBySid.set(r.sid, r.correct);
  let exits = 0;
  let afterError = 0;
  const idx: number[] = [];
  for (const r of log) {
    if (r.type !== 'session' || r.phase !== 'end' || r.completed !== false || !r.items) continue;
    const last = r.lastCorrect ?? lastBySid.get(r.sid) ?? null;
    if (last === null) continue;
    exits++;
    if (!last) afterError++;
    if (typeof r.exitIndex === 'number') idx.push(r.exitIndex);
  }
  return { exits, afterError, share: exits ? afterError / exits : null, medianIndex: median(idx) };
}

/**
 * Highest hint-ladder tier used on a response: 0 none, 1 strategy prompt,
 * 2 first hop, 3 first worked step (§1.11). The logged `tier` when present;
 * records from before the ladder (`hint` without a tier) count as tier 2,
 * the same rule the engine credits them by (engine/observe.hintTierOf).
 */
export const hintTier = (r: ItemRecord): number => hintTierOf(r.hint, r.tier);

export interface HintStats {
  /** Untimed Band B/C first attempts (Band A has no hint button). */
  n: number;
  used: number;
  share: number | null;
  /** First attempts per tier 0–3. */
  byTier: number[];
}

export function hintUsage(log: readonly LogRecord[]): HintStats {
  const fa = firstAttempts(log).filter((r) => r.band !== 'A');
  const byTier = [0, 0, 0, 0];
  for (const r of fa) byTier[Math.min(3, hintTier(r))]!++;
  const used = fa.length - byTier[0]!;
  return { n: fa.length, used, share: fa.length ? used / fa.length : null, byTier };
}

/** Time spent on the feedback after a wrong answer (EVENTS.FEEDBACK), in ms. */
export function feedbackTime(log: readonly LogRecord[]): { n: number; medianMs: number | null } {
  const ms: number[] = [];
  for (const r of log) {
    if (r.type !== 'event' || r.name !== EVENTS.FEEDBACK) continue;
    const v = r.data?.ms;
    if (typeof v === 'number' && Number.isFinite(v)) ms.push(v);
  }
  return { n: ms.length, medianMs: median(ms) };
}

export type StrategyStage = 'counting' | 'mixed' | 'retrieval';

export interface StrategyRow {
  skill: SkillId;
  /** Band A first attempts answered on the pads. */
  n: number;
  /** Answered with the hop buttons (counting on) vs by tapping the pad directly. */
  hops: number;
  taps: number;
  hopShare: number;
  /** Median time of correct answers in the earlier and later half of the attempts (null below 4 attempts). */
  latency: { early: number | null; late: number | null };
  /** Heuristic reading of the later half; null below 6 attempts. */
  stage: StrategyStage | null;
}

/**
 * Band A strategy per skill (Siegler's overlapping waves): the share of
 * answers made by pressing hop buttons (counting on) versus tapping the pad
 * directly, and whether answers get faster. Counting while the later half
 * still uses hops at least 60% of the time; retrieval once it is at most 20%
 * hops and correct answers are no slower than in the earlier half; mixed in
 * between. A reading for the adult, never used by the engine.
 */
export function strategyA(log: readonly LogRecord[]): StrategyRow[] {
  const by = new Map<SkillId, ItemRecord[]>();
  for (const r of firstAttempts(log)) {
    if (r.band !== 'A' || (r.input !== 'hops' && r.input !== 'tap')) continue;
    const list = by.get(r.skill);
    if (list) list.push(r);
    else by.set(r.skill, [r]);
  }
  const hopShare = (rs: ItemRecord[]): number => (rs.length ? rs.filter((r) => r.input === 'hops').length / rs.length : 0);
  const speed = (rs: ItemRecord[]): number | null => median(rs.filter((r) => r.correct).map((r) => r.latency));
  return [...by.entries()]
    .map(([skill, rs]) => {
      const sorted = [...rs].sort((a, b) => a.ts - b.ts);
      const half = Math.ceil(sorted.length / 2);
      const early = sorted.slice(0, half);
      const late = sorted.slice(half);
      const hops = sorted.filter((r) => r.input === 'hops').length;
      const split = sorted.length >= 4;
      const latency = { early: split ? speed(early) : null, late: split ? speed(late) : null };
      let stage: StrategyStage | null = null;
      if (sorted.length >= 6) {
        const lateHops = hopShare(late);
        const notSlower = latency.early === null || latency.late === null || latency.late <= latency.early;
        stage = lateHops >= 0.6 ? 'counting' : lateHops <= 0.2 && notSlower ? 'retrieval' : 'mixed';
      }
      return { skill, n: sorted.length, hops, taps: sorted.length - hops, hopShare: hops / sorted.length, latency, stage };
    })
    .sort((a, b) => b.n - a.n);
}
