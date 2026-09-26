/**
 * "Glicko-Elo": an Elo-style rating per (player, skill) that also tracks its
 * own uncertainty. It is a one-step Laplace (Kalman-style) update of a
 * Gaussian belief over ability under a Rasch model:
 *
 *   μ̃   = μ + λ                                 λ = 0.03 expected learning per item (AFM)
 *   p   = σ(μ̃ − d)
 *   s2' = 1 / (1/(s2 + q) + p(1 − p))          q = 0.03 process noise
 *   μ'  = μ̃ + w · s2' · (y − p)                w = observation weight
 *
 * i.e. classic Elo θ ← θ + K(y − p) with K = s2' derived rather than tuned:
 * large while the model is unsure (fast cold start), ≈0.3 at steady state
 * (keeps tracking a learning child). Predictions integrate the uncertainty
 * (probit approximation) so a fresh estimate is not over-confident, and apply
 * a forgetting penalty from the memory model.
 */
import type { SkillDef } from '../skills/types';
import { DAY_MS } from '../time';
import { retrievability } from './memory';
import type { LearnerModel, Observation, SkillState, SkillStatus } from './model';
import { DIFFICULTY, MASTERY, MODEL } from './params';

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
export const logit = (p: number): number => Math.log(p / (1 - p));

export const levelToDifficulty = (level: number): number => DIFFICULTY.LO + level * (DIFFICULTY.HI - DIFFICULTY.LO);
export const difficultyToLevel = (d: number): number => (d - DIFFICULTY.LO) / (DIFFICULTY.HI - DIFFICULTY.LO);

/** Variance including time away since the last observation. */
function effectiveS2(state: SkillState, now: number): number {
  const days = Math.max(0, now - state.lastSeen) / DAY_MS;
  return Math.min(MODEL.S2_MAX, state.s2 + MODEL.Q_DAY * days);
}

function effectiveMu(state: SkillState, now: number): number {
  return state.mu - MODEL.FORGET * (1 - retrievability(state, now));
}

/** E[σ(x)] for x ~ N(m, v), MacKay's probit approximation. */
const expectedSigmoid = (m: number, v: number): number => sigmoid(m / Math.sqrt(1 + (Math.PI * v) / 8));

function recentCorrect(state: SkillState): number {
  let c = 0;
  for (let i = 0; i < state.recentN; i++) if (state.recent & (1 << i)) c++;
  return c;
}

export function masteryDifficulty(skill: SkillDef): number {
  return levelToDifficulty(skill.masteryLevel ?? MASTERY.LEVEL);
}

export const glickoElo: LearnerModel = {
  id: 'glicko-elo-v1',

  init(_skill, now, prior) {
    return {
      mu: prior?.mu ?? MODEL.PRIOR_MU,
      s2: prior?.s2 ?? MODEL.PRIOR_S2,
      n: 0,
      correct: 0,
      recent: 0,
      recentN: 0,
      lastSeen: now,
      status: 'available',
      origin: prior?.origin ?? 'practice',
    };
  },

  predict(state, difficulty, now) {
    return expectedSigmoid(effectiveMu(state, now) - difficulty, effectiveS2(state, now));
  },

  difficultyFor(state, p, now) {
    const v = effectiveS2(state, now);
    return effectiveMu(state, now) - logit(p) * Math.sqrt(1 + (Math.PI * v) / 8);
  },

  update(state, obs: Observation) {
    const s2prior = Math.min(MODEL.S2_MAX, effectiveS2(state, obs.ts) + MODEL.Q_ITEM);
    // Prior mean moves by the expected learning from this practice opportunity.
    const drift = state.status === 'mastered' ? 0 : MODEL.LEARN_PER_ITEM * obs.weight;
    const muPrior = state.mu + drift;
    const p = sigmoid(muPrior - MODEL.FORGET * (1 - retrievability(state, obs.ts)) - obs.difficulty);
    const w = obs.weight;
    const s2post = Math.max(MODEL.S2_MIN, 1 / (1 / s2prior + w * p * (1 - p)));
    const mu = muPrior + w * s2post * (obs.y - p);
    const correct = obs.y >= 1;
    return {
      ...state,
      mu,
      s2: w > 0 ? s2post : state.s2,
      n: state.n + 1,
      correct: state.correct + (correct ? 1 : 0),
      recent: ((state.recent << 1) | (correct ? 1 : 0)) & 0xff,
      recentN: Math.min(8, state.recentN + 1),
      lastSeen: obs.ts,
    };
  },

  masteryP(state, skill, now) {
    const sd = Math.sqrt(effectiveS2(state, now));
    return sigmoid(effectiveMu(state, now) - MASTERY.Z * sd - masteryDifficulty(skill));
  },

  status(state, skill, unlocked, now): SkillStatus {
    if (!state) return unlocked ? 'available' : 'locked';
    const pm = glickoElo.masteryP(state, skill, now);
    const prev = state.status;
    const meetsMastered =
      pm >= MASTERY.MASTERED_P && state.n >= MASTERY.MASTERED_MIN_N && recentCorrect(state) >= MASTERY.MASTERED_RECENT;
    if (meetsMastered || (prev === 'mastered' && pm >= MASTERY.KEEP_MASTERED_P)) return 'mastered';
    const meetsProficient =
      pm >= MASTERY.PROFICIENT_P && (state.n >= MASTERY.PROFICIENT_MIN_N || state.origin === 'placement');
    if (meetsProficient || ((prev === 'proficient' || prev === 'mastered') && pm >= MASTERY.KEEP_PROFICIENT_P)) {
      return 'proficient';
    }
    if (!unlocked && state.proficientAt === undefined && state.n === 0) return 'locked';
    return state.n > 0 ? 'learning' : 'available';
  },
};
