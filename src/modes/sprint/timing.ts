/**
 * Sprint timing, derived from the child's OWN recent latencies per skill:
 *
 *   par(skill)     = 1.25 × median latency of the last 20 correct first attempts
 *                    on that skill (fallback: all fluency skills, then 6 s),
 *                    clamped to [1.5 s, 15 s]
 *   wrong answer   = +2 × par seconds
 *
 * With penalty = 2·par, guessing only pays if more than 2/3 of guesses are
 * right, and trading accuracy for speed loses: e.g. at par 3 s, careful play
 * (95%, 3 s) scores 0.29 correct/s; rushing (80%, 2.1 s) scores 0.26.
 */
import type { ItemRecord, LogRecord } from '../../core/log/types';
import type { SkillId } from '../../core/types';

export const PAR_FACTOR = 1.25;
export const PENALTY_FACTOR = 2;
export const PAR_MIN_MS = 1500;
export const PAR_MAX_MS = 15000;
export const PAR_FALLBACK_MS = 6000;
export const SPRINT_ITEMS = 12;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function parFor(log: readonly LogRecord[], skill: SkillId, fluencySkills: ReadonlySet<SkillId>): number {
  const correctFirst = log.filter((r): r is ItemRecord => r.type === 'item' && r.attempt === 1 && r.correct && !r.hint);
  const own = correctFirst.filter((r) => r.skill === skill).slice(-20).map((r) => r.latency);
  const pool = own.length >= 5 ? own : correctFirst.filter((r) => fluencySkills.has(r.skill)).slice(-20).map((r) => r.latency);
  const med = median(pool) ?? PAR_FALLBACK_MS / PAR_FACTOR;
  return Math.min(PAR_MAX_MS, Math.max(PAR_MIN_MS, Math.round(PAR_FACTOR * med)));
}

export function penaltyMs(par: number): number {
  return Math.round((PENALTY_FACTOR * par) / 500) * 500;
}

/** Items the shadow (previous best, or par pace) has completed at elapsed time `ms`. */
export function shadowProgress(splits: readonly number[] | null, parPerItem: number, ms: number, total: number): number {
  if (!splits || !splits.length) return Math.min(total, ms / parPerItem);
  let i = 0;
  while (i < splits.length && splits[i]! <= ms) i++;
  if (i >= splits.length) return total;
  const prev = i === 0 ? 0 : splits[i - 1]!;
  return Math.min(total, i + (ms - prev) / Math.max(1, splits[i]! - prev));
}
