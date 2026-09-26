/**
 * Spaced retrieval: a half-life memory model per skill (FSRS-flavoured SM-2).
 *
 *   R(t) = 2^(−Δt / h)                       predicted recall after Δt days
 *   success: h ← h · max(1.1, 1 + 4·(1 − R))  harder (later) recall ⇒ bigger gain
 *   failure: h ← max(0.5, h / 2)
 *   due when R < 0.8
 *
 * With h0 = 2 days this yields review gaps of ≈0.6, 1.3, 2.5, 4.7, 9, 17, 32 days
 * for a child who succeeds each time, and pulls a skill forward after a lapse.
 * Practice within 12 h of the last memory event is massed and does not count.
 */
import { DAY_MS } from '../time';
import type { SkillState } from './model';
import { MEMORY } from './params';

export function retrievability(state: SkillState, now: number): number {
  if (state.h === undefined || state.lastReview === undefined) return 1;
  const days = Math.max(0, now - state.lastReview) / DAY_MS;
  return 2 ** (-days / state.h);
}

export function isDue(state: SkillState, now: number): boolean {
  return state.h !== undefined && retrievability(state, now) < MEMORY.DUE_R;
}

/** Start the memory clock when a skill first becomes proficient. */
export function startMemory(state: SkillState, now: number, h = MEMORY.H0_DAYS): SkillState {
  if (state.h !== undefined) return state;
  return { ...state, h, lastReview: now, lapses: 0 };
}

/** Apply a first-attempt outcome as a memory event if spaced enough from the last one. */
export function memoryEvent(state: SkillState, correct: boolean, now: number): { state: SkillState; counted: boolean; R: number } {
  if (state.h === undefined || state.lastReview === undefined) return { state, counted: false, R: 1 };
  const R = retrievability(state, now);
  if (now - state.lastReview < MEMORY.MIN_GAP_HOURS * 3_600_000) return { state, counted: false, R };
  const h = correct
    ? Math.min(MEMORY.H_MAX_DAYS, state.h * Math.max(MEMORY.MIN_GROWTH, 1 + MEMORY.GROWTH * (1 - R)))
    : Math.max(MEMORY.H_MIN_DAYS, state.h * MEMORY.LAPSE);
  return {
    state: { ...state, h, lastReview: now, lapses: (state.lapses ?? 0) + (correct ? 0 : 1) },
    counted: true,
    R,
  };
}

/** Days until the skill becomes due (0 if already due). */
export function daysUntilDue(state: SkillState, now: number): number | null {
  if (state.h === undefined || state.lastReview === undefined) return null;
  const dueAfter = state.h * Math.log2(1 / MEMORY.DUE_R);
  const elapsed = (now - state.lastReview) / DAY_MS;
  return Math.max(0, dueAfter - elapsed);
}
