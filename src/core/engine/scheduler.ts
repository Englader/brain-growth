/**
 * Which skill comes next. Interleaved, not blocked:
 *
 *   frontier  unlocked, not yet mastered      weight ∝ exp(−0.8·Δgrade) (earliest gaps first)
 *   review    proficient/mastered, R < 0.8    weight ∝ (1 − R)
 *   maintain  mastered, not due               weight 1 (variety, retrieval practice)
 *
 * Bucket mix is 60/30/10 when reviews are due, 85/0/15 otherwise. No skill
 * three times in a row; at most two never-seen skills per session; the first
 * item of a session is a known skill (a success to start on, and it doubles
 * as retrieval practice).
 */
import type { Capability } from '../items/types';
import type { Rng } from '../rng';
import type { SkillGraph } from '../skills/graph';
import type { GeneratorBinding, SkillDef } from '../skills/types';
import type { SkillId } from '../types';
import { getGenerator } from '../items/generators/registry';
import { isDue, retrievability } from './memory';
import type { LearnerModel, SkillState } from './model';
import { SELECTION } from './params';

export type ItemSource = 'placement' | 'warmup' | 'frontier' | 'review' | 'maintain' | 'retry' | 'fixed';

export interface Eligibility {
  requires: readonly Capability[];
  allowReading: boolean;
  /** Extra per-mode filter (e.g. timed mode: fluency skills at proficiency). */
  filter?: (skill: SkillDef, state: SkillState | undefined) => boolean;
}

export function compatibleBindings(skill: SkillDef, elig: Eligibility): GeneratorBinding[] {
  return (skill.gens ?? []).filter((b) => {
    const caps = getGenerator(b.id).capabilities;
    if (!elig.allowReading && caps.includes('reading')) return false;
    return elig.requires.every((c) => caps.includes(c));
  });
}

export function isUnlocked(graph: SkillGraph, skillId: SkillId, states: Record<SkillId, SkillState>): boolean {
  return graph.effectivePrereqs(skillId).every((p) => states[p]?.proficientAt !== undefined);
}

export interface ScheduleInput {
  graph: SkillGraph;
  model: LearnerModel;
  states: Record<SkillId, SkillState>;
  now: number;
  rng: Rng;
  eligibility: Eligibility;
  /** Skill ids presented so far this session, oldest first. */
  history: SkillId[];
  newIntroduced: number;
}

export interface ScheduledSkill {
  skillId: SkillId;
  source: ItemSource;
}

interface Cand {
  skill: SkillDef;
  weight: number;
}

export function classify(input: ScheduleInput): { frontier: Cand[]; review: Cand[]; maintain: Cand[] } {
  const { graph, states, now, eligibility } = input;
  const frontier: Cand[] = [];
  const review: Cand[] = [];
  const maintain: Cand[] = [];
  for (const skill of graph.playableSkills()) {
    const st = states[skill.id];
    if (!compatibleBindings(skill, eligibility).length) continue;
    if (eligibility.filter && !eligibility.filter(skill, st)) continue;
    const unlocked = isUnlocked(graph, skill.id, states);
    const status = input.model.status(st, skill, unlocked, now);
    if (status === 'locked') continue;
    if (st && isDue(st, now)) review.push({ skill, weight: 1 - retrievability(st, now) + 0.05 });
    else if (status === 'mastered') maintain.push({ skill, weight: 1 });
    if (status !== 'mastered') {
      if (!st || st.n === 0) {
        if (input.newIntroduced >= SELECTION.MAX_NEW_PER_SESSION) continue;
        frontier.push({ skill, weight: 1 });
      } else frontier.push({ skill, weight: SELECTION.IN_PROGRESS_BOOST });
    }
  }
  if (frontier.length) {
    const g0 = Math.min(...frontier.map((c) => c.skill.grade));
    for (const c of frontier) c.weight *= Math.exp(-SELECTION.GRADE_DECAY * (c.skill.grade - g0));
  }
  return { frontier, review, maintain };
}

export function chooseSkill(input: ScheduleInput): ScheduledSkill | null {
  const { rng, history } = input;
  const buckets = classify(input);
  const last = history[history.length - 1];
  const prev = history[history.length - 2];

  const penalise = (cands: Cand[]): Cand[] => {
    const kept = cands.filter((c) => !(c.skill.id === last && c.skill.id === prev));
    return (kept.length ? kept : cands).map((c) => ({ ...c, weight: c.weight * (c.skill.id === last ? 0.3 : 1) }));
  };
  const pickFrom = (cands: Cand[]): SkillDef | null => {
    const pc = penalise(cands);
    if (!pc.length) return null;
    return pc[rng.weighted(pc.map((c) => c.weight))]!.skill;
  };

  // Warm-up: open with something the child knows.
  if (history.length === 0) {
    const known = [...buckets.review, ...buckets.maintain];
    const s = pickFrom(known);
    if (s) return { skillId: s.id, source: 'warmup' };
  }

  const mix = buckets.review.length ? SELECTION.MIX_WITH_REVIEW : SELECTION.MIX_NO_REVIEW;
  const order: Array<[ItemSource, Cand[], number]> = [
    ['frontier', buckets.frontier, mix.frontier],
    ['review', buckets.review, mix.review],
    ['maintain', buckets.maintain, mix.maintain],
  ];
  const available = order.filter(([, c]) => c.length > 0);
  if (!available.length) return null;
  const idx = rng.weighted(available.map(([, , w]) => (w > 0 ? w : 0.05)));
  const [source, cands] = available[idx]!;
  const s = pickFrom(cands);
  return s ? { skillId: s.id, source } : null;
}
