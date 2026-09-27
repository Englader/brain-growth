/**
 * The seam between the adaptive engine and everything else.
 *
 * Game modes never see ratings; they ask the session engine for items and
 * report responses. The session engine talks to a LearnerModel through this
 * interface only, so the Glicko-Elo model can be swapped for BKT, PFA or a
 * learned model by implementing LearnerModel and replaying the session log
 * (engine/replay.ts) to warm-start it — no game code changes.
 */
import type { SkillDef } from '../skills/types';

export type SkillStatus = 'locked' | 'available' | 'learning' | 'proficient' | 'mastered';

/** Persisted per (player, skill). Plain JSON. Fields are model-owned except the memory block. */
export interface SkillState {
  /** Ability mean (logits, on the skill's difficulty scale). */
  mu: number;
  /** Ability variance. */
  s2: number;
  /** First-attempt observations / correct among them. */
  n: number;
  correct: number;
  /** Last ≤8 first-attempt outcomes as a bitmask (bit 0 = newest, 1 = correct). */
  recent: number;
  recentN: number;
  lastSeen: number;
  status: SkillStatus;
  proficientAt?: number;
  masteredAt?: number;
  /** Spaced-retrieval memory (present once proficient). */
  h?: number;
  lastReview?: number;
  lapses?: number;
  origin: 'practice' | 'placement';
}

export interface Observation {
  /** 1 = correct first attempt, 1 − 0.25·tier = correct after hint tier 1–3 (observe.hintCredit), 0 = wrong. */
  y: number;
  difficulty: number;
  ts: number;
  /** 0..1 weight on the ability update (timed items use MODEL.TIMED_WEIGHT). */
  weight: number;
}

export interface LearnerModel {
  readonly id: string;
  init(skill: SkillDef, now: number, prior?: { mu: number; s2: number; origin?: SkillState['origin'] }): SkillState;
  /** P(correct) on an item of `difficulty`, integrating ability uncertainty and forgetting. */
  predict(state: SkillState, difficulty: number, now: number): number;
  /** Inverse of predict: the difficulty at which P(correct) = p. */
  difficultyFor(state: SkillState, p: number, now: number): number;
  update(state: SkillState, obs: Observation): SkillState;
  /** Conservative P(correct) at the skill's mastery bar — the number shown as "mastery %". */
  masteryP(state: SkillState, skill: SkillDef, now: number): number;
  /** Status given current evidence and whether prerequisites allow the skill. */
  status(state: SkillState | undefined, skill: SkillDef, unlocked: boolean, now: number): SkillStatus;
}
