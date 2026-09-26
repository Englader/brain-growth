/**
 * Cold-start placement: a 1-D Bayesian computerized-adaptive test over the
 * child's position g on the curriculum axis, embedded in the first ordinary
 * game session (no "test" screen, no failure framing).
 *
 * Model: a child at curriculum position g has ability on skill s
 *     θ_s(g) = SLOPE·(g − grade_s) + OFFSET
 * and answers an item of difficulty d correctly with p = σ(θ_s(g) − d).
 * The posterior over g lives on a 0.1-grade grid, prior N(age-based, 1.5²).
 *
 * Item choice: any (skill, level) pair can be tuned to a given p, and the
 * Fisher information about g is SLOPE²·p(1−p) regardless of the skill, so we
 * pick skills near the posterior mean (relevance, variety) and set the level
 * for p = 0.8 — 64% of the information of a p = 0.5 item with 60% fewer
 * errors; simulated placement accuracy is flat across 0.72–0.82 (npm run sim).
 * After ≤8 items every skill receives a prior from the posterior.
 */
import type { Rng } from '../rng';
import type { SkillGraph } from '../skills/graph';
import type { SkillDef } from '../skills/types';
import type { SkillId } from '../types';
import { difficultyToLevel, levelToDifficulty, logit, sigmoid } from './glicko';
import { PLACEMENT } from './params';

export interface PlacementState {
  /** Posterior weights on the grid (normalised). */
  post: number[];
  items: number;
  done: boolean;
  /** Skills already used, to keep variety. */
  used: SkillId[];
}

const GRID: number[] = (() => {
  const g: number[] = [];
  for (let x = PLACEMENT.GRID_MIN; x <= PLACEMENT.GRID_MAX + 1e-9; x += PLACEMENT.GRID_STEP) g.push(Math.round(x * 10) / 10);
  return g;
})();

export const thetaAt = (g: number, skill: SkillDef): number => PLACEMENT.SLOPE * (g - skill.grade) + PLACEMENT.OFFSET;

/**
 * Prior mean from age. In North Macedonia children start одделение 1 in the
 * September of the year they turn 6, so at age a a child is "currently
 * learning" roughly grade a − 5 content (5 → preschool, 8 → одделение 3).
 */
export function priorGradeForAge(age: number): number {
  return Math.min(PLACEMENT.GRID_MAX, Math.max(0, age - 5));
}

export function startPlacement(age: number): PlacementState {
  const mean = priorGradeForAge(age);
  const w = GRID.map((g) => Math.exp(-0.5 * ((g - mean) / PLACEMENT.PRIOR_SD) ** 2));
  const z = w.reduce((a, b) => a + b, 0);
  return { post: w.map((x) => x / z), items: 0, done: false, used: [] };
}

export function posteriorStats(state: PlacementState): { mean: number; sd: number } {
  let m = 0;
  state.post.forEach((w, i) => (m += w * GRID[i]!));
  let v = 0;
  state.post.forEach((w, i) => (v += w * (GRID[i]! - m) ** 2));
  return { mean: m, sd: Math.sqrt(v) };
}

export interface PlacementPick {
  skillId: SkillId;
  level: number;
}

/**
 * Choose the next placement probe among `candidates` (playable, mode- and
 * band-compatible skills).
 */
export function nextPlacementItem(state: PlacementState, candidates: SkillDef[], rng: Rng): PlacementPick | null {
  const { mean } = posteriorStats(state);
  const scored: Array<{ skill: SkillDef; level: number; dist: number }> = [];
  for (const skill of candidates) {
    // Expected level for target p under the posterior mean.
    const d = thetaAt(mean, skill) - logit(PLACEMENT.TARGET_P);
    const level = difficultyToLevel(d);
    if (level < -0.05 || level > 1.05) continue; // cannot hit target p on this skill
    const recentlyUsed = state.used.slice(-2).includes(skill.id);
    scored.push({
      skill,
      level: Math.min(1, Math.max(0, level)),
      // Most informative region is just below the mean (items the child should mostly get).
      dist: Math.abs(skill.grade - (mean - 0.5)) + (recentlyUsed ? 2 : 0),
    });
  }
  if (!scored.length) {
    // Fall back to the easiest candidate at level 0 (very young children, tiny graph).
    const easiest = [...candidates].sort((a, b) => a.grade - b.grade)[0];
    return easiest ? { skillId: easiest.id, level: 0 } : null;
  }
  scored.sort((a, b) => a.dist - b.dist);
  const top = scored.slice(0, 3);
  const choice = rng.pick(top);
  return { skillId: choice.skill.id, level: choice.level };
}

/** Bayesian update of the grid posterior with one first-attempt outcome. */
export function updatePlacement(state: PlacementState, skill: SkillDef, level: number, correct: boolean): PlacementState {
  const d = levelToDifficulty(level);
  const post = state.post.map((w, i) => {
    const p = sigmoid(thetaAt(GRID[i]!, skill) - d);
    return w * (correct ? p : 1 - p);
  });
  const z = post.reduce((a, b) => a + b, 0) || 1;
  const next: PlacementState = {
    post: post.map((x) => x / z),
    items: state.items + 1,
    done: false,
    used: [...state.used, skill.id],
  };
  const { sd } = posteriorStats(next);
  next.done =
    next.items >= PLACEMENT.MAX_ITEMS || (next.items >= PLACEMENT.MIN_ITEMS && sd < PLACEMENT.STOP_SD);
  return next;
}

/**
 * Priors for every playable skill from the final posterior:
 * μ_s = E[θ_s(g)], s2_s = Var[θ_s(g)] + SKILL_S2, with μ capped below mastery.
 */
export function placementPriors(state: PlacementState, graph: SkillGraph): Map<SkillId, { mu: number; s2: number }> {
  const out = new Map<SkillId, { mu: number; s2: number }>();
  for (const skill of graph.playableSkills()) {
    let m = 0;
    state.post.forEach((w, i) => (m += w * thetaAt(GRID[i]!, skill)));
    let v = 0;
    state.post.forEach((w, i) => (v += w * (thetaAt(GRID[i]!, skill) - m) ** 2));
    out.set(skill.id, {
      mu: Math.min(PLACEMENT.MU_CAP, Math.max(PLACEMENT.MU_FLOOR, m)),
      s2: v + PLACEMENT.SKILL_S2,
    });
  }
  return out;
}
