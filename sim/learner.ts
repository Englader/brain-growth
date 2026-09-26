/**
 * Simulated learners — the right tool for testing an adaptive engine: we know
 * the ground truth, so we can measure placement error, realised success rate
 * and tracking without a single real child.
 *
 * The generative model is deliberately MISSPECIFIED relative to the engine:
 * per-child slope and offset differ from the engine's constants, every skill
 * has an idiosyncratic offset (uneven profiles), answers have slips, and
 * ability grows with practice. An engine that only works when its own
 * assumptions hold would fail these tests.
 */
import { levelToDifficulty, sigmoid } from '../src/core/engine/glicko';
import type { PresentedItem } from '../src/core/engine/session';
import type { Response } from '../src/core/items/grade';
import { key, toNumber } from '../src/core/rational';
import type { Rng } from '../src/core/rng';
import type { SkillGraph } from '../src/core/skills/graph';
import type { SkillId } from '../src/core/types';

export interface SimLearnerParams {
  g: number;
  slope: number;
  offset: number;
  skillSd: number;
  slip: number;
  learnRate: number;
}

export class SimLearner {
  readonly theta = new Map<SkillId, number>();

  constructor(
    readonly params: SimLearnerParams,
    graph: SkillGraph,
    rng: Rng,
  ) {
    for (const s of graph.playableSkills()) {
      this.theta.set(s.id, params.slope * (params.g - s.grade) + params.offset + rng.normal() * params.skillSd);
    }
  }

  pCorrect(skillId: SkillId, level: number): number {
    const th = this.theta.get(skillId) ?? -3;
    return (1 - this.params.slip) * sigmoid(th - levelToDifficulty(level));
  }

  respond(p: PresentedItem, rng: Rng): { response: Response; correct: boolean } {
    const correct = rng.chance(this.pCorrect(p.item.skillId, p.item.level));
    // Practice effect: bigger when the item is near the child's edge.
    const th = this.theta.get(p.item.skillId) ?? -3;
    const q = sigmoid(th - levelToDifficulty(p.item.level));
    this.theta.set(p.item.skillId, th + this.params.learnRate * 4 * q * (1 - q));
    const ans = p.item.answer.value;
    if (correct) {
      const tol = p.item.answer.tolerance;
      return { correct, response: tol ? { kind: 'landed', value: toNumber(ans) } : { kind: 'typed', raw: key(ans) } };
    }
    const mis = p.item.misconceptions[0];
    const wrong = mis ? mis.value : toNumber(ans) + (tolOr1(p) + 1);
    return { correct, response: p.item.answer.tolerance ? { kind: 'landed', value: wrong } : { kind: 'typed', raw: String(wrong) } };
  }
}

function tolOr1(p: PresentedItem): number {
  return p.item.answer.tolerance ?? 1;
}

export function randomLearner(rng: Rng, graph: SkillGraph, gRange: [number, number]): SimLearner {
  return new SimLearner(
    {
      g: gRange[0] + rng.next() * (gRange[1] - gRange[0]),
      slope: 1.3 + rng.next() * 1.0, // engine assumes 1.8
      offset: -1.0 + rng.next() * 1.0, // engine assumes −0.5
      skillSd: 0.6,
      slip: 0.03,
      learnRate: 0.08,
    },
    graph,
    rng,
  );
}
