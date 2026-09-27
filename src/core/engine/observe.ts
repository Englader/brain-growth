/**
 * The single per-observation state transition, shared by live sessions and by
 * log replay so the two can never drift apart.
 */
import type { SkillId } from '../types';
import type { EngineContext } from './session';
import { memoryEvent, startMemory } from './memory';
import type { SkillState, SkillStatus } from './model';
import { MODEL } from './params';
import { isUnlocked } from './scheduler';

export interface FirstAttempt {
  correct: boolean;
  hint: boolean;
  difficulty: number;
  ts: number;
  timed: boolean;
  /** Evidence weight of this observation (MODE_EVIDENCE of its mode); default 1. */
  weight?: number;
  /** Highest hint tier used (1–3); null/absent = none, or a record from before tiers (then `hint` alone decides). */
  tier?: number | null;
}

/**
 * Outcome credit y of a correct first attempt: 1 unaided, 1 − 0.25·tier with
 * a tiered hint, and HINT_CREDIT (0.5, i.e. tier 2) for a hint without a tier
 * (legacy records), so replaying old logs is unchanged.
 */
export function hintCredit(hint: boolean, tier?: number | null): number {
  if (tier !== null && tier !== undefined && tier > 0) return Math.max(0, 1 - MODEL.HINT_TIER_PENALTY * tier);
  return hint ? MODEL.HINT_CREDIT : 1;
}

export interface ObservationEffect {
  states: Record<SkillId, SkillState>;
  statusChange: { skillId: SkillId; from: SkillStatus; to: SkillStatus } | null;
  memoryReview: { R: number; correct: boolean } | null;
}

export function applyFirstAttempt(
  ctx: Pick<EngineContext, 'graph' | 'model'>,
  states: Record<SkillId, SkillState>,
  skillId: SkillId,
  obs: FirstAttempt,
): ObservationEffect {
  const skill = ctx.graph.get(skillId);
  const now = obs.ts;
  let st = states[skillId] ?? ctx.model.init(skill, now);
  const fromStatus = ctx.model.status(st, skill, isUnlocked(ctx.graph, skillId, states), now);
  const hinted = obs.hint || (obs.tier ?? 0) > 0;
  const clean = obs.correct && !hinted;

  // 1) spaced-retrieval memory event (only if spaced enough from the previous one)
  const mem = memoryEvent(st, clean, now);
  st = mem.state;

  // 2) ability update; timed observations do not move ability (DESIGN §1.7); modes may weigh evidence
  const weight = obs.timed ? MODEL.TIMED_WEIGHT : obs.weight ?? 1;
  if (weight > 0) {
    st = ctx.model.update(st, {
      y: obs.correct ? hintCredit(obs.hint, obs.tier) : 0,
      difficulty: obs.difficulty,
      ts: now,
      weight,
    });
  }

  // 3) status, with sticky first-time timestamps (unlocks never re-lock)
  const next = { ...states, [skillId]: st };
  const toStatus = ctx.model.status(st, skill, isUnlocked(ctx.graph, skillId, next), now);
  st = { ...st, status: toStatus };
  if ((toStatus === 'proficient' || toStatus === 'mastered') && st.proficientAt === undefined) {
    st = startMemory({ ...st, proficientAt: now }, now);
  }
  if (toStatus === 'mastered' && st.masteredAt === undefined) st = { ...st, masteredAt: now };
  next[skillId] = st;

  return {
    states: next,
    statusChange: toStatus !== fromStatus ? { skillId, from: fromStatus, to: toStatus } : null,
    memoryReview: mem.counted ? { R: mem.R, correct: clean } : null,
  };
}
