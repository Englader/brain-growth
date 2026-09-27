import type { ModeId } from '../types';

/**
 * Every tunable constant of the adaptive engine, in one place, with the value
 * actually shipped. DESIGN.md §1.5 derives and justifies each; the simulated-
 * learner tests (tests/engine.sim.test.ts) pin the behaviour they produce.
 */

/** Generator level ℓ ∈ [0,1] maps linearly to item difficulty on the logit scale. */
export const DIFFICULTY = {
  LO: -2.5,
  HI: 2.5,
} as const;

export const MODEL = {
  /** Prior for a skill unlocked through practice (child just became proficient at its prerequisites). */
  PRIOR_MU: -0.5,
  PRIOR_S2: 1.5,
  /** Process noise added before every observation: children learn, ratings must keep moving. */
  Q_ITEM: 0.03,
  /**
   * Expected learning per practice opportunity (logits), as in the Additive Factors
   * Model / PFA. Without it the filter lags a child who is learning (simulation: −0.9
   * logit bias). Applied to the prior mean before each update, for non-mastered skills.
   */
  LEARN_PER_ITEM: 0.03,
  /** Variance growth per day without practice (uncertainty returns as memory fades). */
  Q_DAY: 0.03,
  S2_MIN: 0.05,
  S2_MAX: 2.0,
  /**
   * Hint ladder (DESIGN §1.5): a correct answer after hint tier t (the highest
   * tier used; 0 = none) earns y = 1 − HINT_TIER_PENALTY·t, so tiers 1/2/3
   * give 0.75/0.5/0.25.
   */
  HINT_TIER_PENALTY: 0.25,
  /**
   * Records from before the ladder carry `hint` without a tier; they count as
   * this tier, so their credit is exactly the old single-hint HINT_CREDIT and
   * replaying old logs gives identical states.
   */
  LEGACY_HINT_TIER: 2,
  /** Credit of the old single hint (= 1 − HINT_TIER_PENALTY·LEGACY_HINT_TIER). */
  HINT_CREDIT: 0.5,
  /** Logits subtracted from ability when predicted recall R → 0 (applied as FORGET·(1−R)). */
  FORGET: 1.0,
  /** Observations made under a clock do not move ability (pressure artefacts); see DESIGN §1.7. */
  TIMED_WEIGHT: 0,
} as const;

export const MASTERY = {
  /** Default generator level that defines the mastery bar (per-skill override in the catalog). */
  LEVEL: 0.75,
  /** Conservative estimate: evaluate at μ − Z·σ. */
  Z: 0.5,
  PROFICIENT_P: 0.55,
  PROFICIENT_MIN_N: 4,
  MASTERED_P: 0.8,
  MASTERED_MIN_N: 8,
  /** Of the last 8 first attempts, at least this many correct. */
  MASTERED_RECENT: 6,
  /** Hysteresis: a status is kept until the estimate falls below these. */
  KEEP_MASTERED_P: 0.6,
  KEEP_PROFICIENT_P: 0.35,
} as const;

export const MEMORY = {
  /** Half-life (days) when a skill first becomes proficient. */
  H0_DAYS: 2,
  /** Successful review: h ← h · max(MIN_GROWTH, 1 + GROWTH·(1 − R)). Harder recall ⇒ bigger gain. */
  GROWTH: 4,
  MIN_GROWTH: 1.1,
  /** Failed review: h ← max(H_MIN, LAPSE · h). */
  LAPSE: 0.5,
  H_MIN_DAYS: 0.5,
  H_MAX_DAYS: 180,
  /** Due for review when predicted recall drops below this. */
  DUE_R: 0.8,
  /** Practice within this window of the last memory event is massed, not spaced: no memory update. */
  MIN_GAP_HOURS: 12,
} as const;

export const SELECTION = {
  /** Proportional success-rate controller: p* ← p_band + GAIN·(p_band − EWMA). */
  CONTROLLER_GAIN: 0.8,
  EWMA_ALPHA: 0.2,
  P_MIN: 0.7,
  P_MAX: 0.95,
  /** "Challenge me" lowers the target success rate by this much. */
  STRETCH_DELTA: 0.1,
  /** Level-space jitter (SD) so consecutive items are not identical in difficulty. */
  JITTER: 0.06,
  /** Bucket mix when reviews are due / not due. */
  MIX_WITH_REVIEW: { frontier: 0.6, review: 0.3, maintain: 0.1 },
  MIX_NO_REVIEW: { frontier: 0.85, review: 0, maintain: 0.15 },
  /** Frontier preference for earlier curriculum: weight ∝ exp(−GRADE_DECAY · Δgrade). */
  GRADE_DECAY: 0.8,
  /** Skills already in progress are preferred over opening new ones. */
  IN_PROGRESS_BOOST: 1.5,
  /** Solid-but-not-mastered skills keep being practised toward mastery, at lower priority. */
  CONSOLIDATE_WEIGHT: 0.5,
  /**
   * ...but consolidation fades for skills more than CONSOLIDATE_SPAN grades below the leading edge
   * (the hardest skill the child is learning): weight × exp(−CONSOLIDATE_BELOW_DECAY · (distance − span)).
   * Placement makes skills far below a child Solid (never mastered); served as consolidation they
   * were 43% of a grade 4–6.5 child's items at 0.96 success, overshooting the target (simulation:
   * 0.912 → 0.880; DESIGN §1.5). Review still reaches them when due.
   */
  CONSOLIDATE_SPAN: 3,
  CONSOLIDATE_BELOW_DECAY: 1.2,
  /** At most this many never-seen skills introduced per session. */
  MAX_NEW_PER_SESSION: 2,
  /** A wrong item returns after this many other items. */
  RETRY_GAP: 3,
} as const;

export const PLACEMENT = {
  GRID_MIN: 0,
  GRID_MAX: 9.9,
  GRID_STEP: 0.1,
  PRIOR_SD: 1.5,
  /** θ_s(g) = SLOPE · (g − grade_s) + OFFSET (logits; per grade of curriculum distance). */
  SLOPE: 1.8,
  OFFSET: -0.5,
  /**
   * Placement items target this success probability: 64% of the Fisher information of a
   * p = 0.5 item, but under half the failures. Simulation (npm run sim): accuracy is flat
   * between 0.72 and 0.82 while errors per placement fall from 2.9 to 2.3.
   */
  TARGET_P: 0.8,
  MIN_ITEMS: 5,
  MAX_ITEMS: 8,
  STOP_SD: 0.35,
  /** Posterior-derived priors never reach "mastered": mastery must be shown, not inferred. */
  MU_CAP: 2.4,
  MU_FLOOR: -1.5,
  /** Extra per-skill variance: children's profiles are uneven. */
  SKILL_S2: 0.5,
} as const;

/**
 * Evidence weight of a first attempt, per mode (0..1), applied to the ability
 * update by live sessions (session.ts) and by log replay (replay.ts, from each
 * record's `mode`) through the same applyFirstAttempt, so the two never drift.
 * Modes absent here count fully (1). Timed items are still MODEL.TIMED_WEIGHT.
 * Use < 1 for modes whose items are noisier evidence of the skill (e.g. a
 * multi-solution deal) until real calibration data exists.
 */
export const MODE_EVIDENCE: Record<ModeId, number> = {
  // ── slot: frac ──
  // ── slot: hint ──
  // ── slot: pilot ──
  // ── slot: storage ──
  // ── slot: weekly ──
  // ── slot: target ──
  // ── slot: dice ──
  // ── slot: puzzle ──
  // ── slot: workshop ──
  // ── slot: balance ──
  // ── slot: coord ──
  // ── slot: season ──
};

export function modeEvidence(mode: ModeId): number {
  return MODE_EVIDENCE[mode] ?? 1;
}
