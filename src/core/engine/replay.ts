/**
 * Rebuild learner state from the session log. Used to:
 *  - warm-start a different LearnerModel (swap Glicko-Elo for BKT: replay, done),
 *  - repair state after a bad migration,
 *  - evaluate engine changes offline against real histories.
 */
import type { LogRecord } from '../log/types';
import { EVENTS } from '../log/types';
import type { SkillId } from '../types';
import type { SkillState } from './model';
import { applyFirstAttempt } from './observe';
import { placementMemory, placementPriors, startPlacement, type PlacementState } from './placement';
import { modeEvidence, PLACEMENT } from './params';
import type { EngineContext } from './session';
import { isUnlocked } from './scheduler';

/** Gaussian posterior on the placement grid from a logged (g, sd) summary. */
export function placementFromSummary(g: number, sd: number): PlacementState {
  const base = startPlacement(0);
  const grid = base.post.map((_, i) => PLACEMENT.GRID_MIN + i * PLACEMENT.GRID_STEP);
  const w = grid.map((x) => Math.exp(-0.5 * ((x - g) / Math.max(sd, 0.05)) ** 2));
  const z = w.reduce((a, b) => a + b, 0);
  return { post: w.map((x) => x / z), items: 0, done: true, used: [] };
}

export function replay(ctx: Pick<EngineContext, 'graph' | 'model'>, records: readonly LogRecord[]): Record<SkillId, SkillState> {
  let states: Record<SkillId, SkillState> = {};
  const sorted = [...records].sort((a, b) => a.ts - b.ts);
  for (const r of sorted) {
    if (r.type === 'event' && r.name === EVENTS.PLACEMENT_DONE && r.data) {
      const g = Number(r.data.g);
      const sd = Number(r.data.sd);
      const priors = placementPriors(placementFromSummary(g, sd), ctx.graph);
      for (const [id, prior] of priors) {
        if (states[id]?.n) continue;
        const skill = ctx.graph.get(id);
        let st = ctx.model.init(skill, r.ts, { ...prior, origin: 'placement' });
        const status = ctx.model.status(st, skill, true, r.ts);
        st = { ...st, status };
        if (status === 'proficient' || status === 'mastered') st = placementMemory(st, skill, g, r.ts);
        states[id] = st;
      }
      for (const id of Object.keys(states)) {
        const skill = ctx.graph.get(id);
        states[id] = { ...states[id]!, status: ctx.model.status(states[id], skill, isUnlocked(ctx.graph, id, states), r.ts) };
      }
      continue;
    }
    if (r.type !== 'item' || r.attempt !== 1 || !ctx.graph.has(r.skill)) continue;
    states = applyFirstAttempt(ctx, states, r.skill, {
      correct: r.correct,
      hint: r.hint,
      difficulty: r.diff,
      ts: r.ts,
      timed: r.timed,
      weight: modeEvidence(r.mode),
    }).states;
  }
  return states;
}
