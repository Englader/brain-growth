/**
 * Which skill comes next. Interleaved, not blocked:
 *
 *   frontier  unlocked, not yet proficient     weight ∝ exp(−0.8·Δgrade) (earliest gaps first),
 *             plus Solid-not-mastered skills at weight 0.5 (consolidation, above the review floor),
 *             fading ×exp(−1.2·d) for skills d grades beyond 3 below the leading edge of learning
 *   review    proficient/mastered, R < 0.8    weight ∝ (1 − R)
 *   maintain  mastered, not due               weight 1 (variety, retrieval practice)
 *
 * Bucket mix is 60/30/10 when reviews are due, 85/0/15 otherwise. No skill
 * three times in a row; at most two never-seen skills per session; the first
 * item of a session is a known skill (a success to start on, and it doubles
 * as retrieval practice).
 *
 * A themed weekly session (Eligibility.boost) multiplies the frontier and
 * review weights of the theme's skills, and after the warm-up draws a share
 * of its items straight from those theme candidates (still never the same
 * skill three times in a row). Maintenance is never boosted. Sessions
 * without a boost consume the RNG exactly as before.
 *
 * A session for a chosen school year (Eligibility.year, DESIGN A-29) sees
 * only that year's skills (grade ∈ [year, year + 1)). Inside it there are no
 * walls: a locked skill counts as available (the engine starts it from its
 * prior, low), and the band's review floor does not apply, because the child
 * chose the year. Warm-up, the new-skill cap and "never three in a row" work
 * as before, within the year. Without a year nothing changes.
 */
import type { Capability } from '../items/types';
import type { Rng } from '../rng';
import type { SkillGraph } from '../skills/graph';
import type { GeneratorBinding, SkillDef } from '../skills/types';
import type { SkillId } from '../types';
import { getGenerator } from '../items/generators/registry';
import { boostedWeight, type ThemeBoost } from '../weekly';
import { inYear } from '../years';
import { isDue, retrievability } from './memory';
import type { LearnerModel, SkillState } from './model';
import { SELECTION } from './params';

export type ItemSource = 'placement' | 'warmup' | 'frontier' | 'review' | 'maintain' | 'retry' | 'fixed';

export interface Eligibility {
  requires: readonly Capability[];
  allowReading: boolean;
  /** Skills below this grade are not offered as review/maintenance (e.g. no counting dots for a 13-year-old). */
  reviewFloor?: number;
  /** Extra per-mode filter (e.g. timed mode: fluency skills at proficiency). */
  filter?: (skill: SkillDef, state: SkillState | undefined) => boolean;
  /** Weekly theme boost: frontier and review weights of these skills ×factor; maintenance untouched. */
  boost?: ThemeBoost;
  /** School year browsed (DESIGN A-29): only skills with grade ∈ [year, year + 1); locked ones count as available; no review floor. */
  year?: number;
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
  /** Not yet proficient (true frontier) vs. consolidating a Solid skill. */
  learning?: boolean;
}

export function classify(input: ScheduleInput): { frontier: Cand[]; review: Cand[]; maintain: Cand[] } {
  const { graph, states, now, eligibility } = input;
  const frontier: Cand[] = [];
  const review: Cand[] = [];
  const maintain: Cand[] = [];
  const year = eligibility.year;
  for (const skill of graph.playableSkills()) {
    if (year !== undefined && !inYear(skill, year)) continue;
    const st = states[skill.id];
    if (!compatibleBindings(skill, eligibility).length) continue;
    if (eligibility.filter && !eligibility.filter(skill, st)) continue;
    // A chosen year has no walls: every one of its skills may be tried.
    const unlocked = year !== undefined || isUnlocked(graph, skill.id, states);
    const status = input.model.status(st, skill, unlocked, now);
    if (status === 'locked') continue;
    const reviewable = year !== undefined || skill.grade >= (eligibility.reviewFloor ?? 0);
    if (st && reviewable && isDue(st, now)) review.push({ skill, weight: 1 - retrievability(st, now) + 0.05 });
    else if (status === 'mastered' && reviewable) maintain.push({ skill, weight: 1 });
    if (status === 'available' || status === 'learning') {
      if (!st || st.n === 0) {
        if (input.newIntroduced >= SELECTION.MAX_NEW_PER_SESSION) continue;
        frontier.push({ skill, weight: 1, learning: true });
      } else frontier.push({ skill, weight: SELECTION.IN_PROGRESS_BOOST, learning: true });
    } else if (status === 'proficient' && reviewable) {
      // Consolidation toward mastery; never below the band's review floor.
      frontier.push({ skill, weight: SELECTION.CONSOLIDATE_WEIGHT, learning: false });
    }
  }
  const learning = frontier.filter((c) => c.learning);
  if (frontier.length) {
    const g0 = Math.min(...(learning.length ? learning : frontier).map((c) => c.skill.grade));
    // The leading edge: the hardest skill the child is learning now.
    const edge = learning.length ? Math.max(...learning.map((c) => c.skill.grade)) : g0;
    for (const c of frontier) {
      c.weight *= Math.exp(-SELECTION.GRADE_DECAY * Math.max(0, c.skill.grade - g0));
      // Consolidation fades far below the leading edge (DESIGN §1.5), as review keeps to the band's
      // floor: a placement-Solid skill that far down is easy even at its hardest level. Review still
      // reaches it when it is due.
      if (!c.learning) c.weight *= Math.exp(-SELECTION.CONSOLIDATE_BELOW_DECAY * Math.max(0, edge - SELECTION.CONSOLIDATE_SPAN - c.skill.grade));
    }
  }
  const { boost } = eligibility;
  if (boost) {
    for (const c of frontier) c.weight = boostedWeight(boost, c.skill.id, 'frontier', c.weight);
    for (const c of review) c.weight = boostedWeight(boost, c.skill.id, 'review', c.weight);
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

  // Themed draw (weekly challenge): part of the session comes from the theme's frontier/review skills.
  const boost = input.eligibility.boost;
  if (boost && boost.share > 0 && rng.chance(boost.share)) {
    const themed: Array<[ItemSource, Cand]> = [
      ...buckets.frontier.map((c): [ItemSource, Cand] => ['frontier', c]),
      ...buckets.review.map((c): [ItemSource, Cand] => ['review', c]),
    ].filter(([, c]) => boost.skills.has(c.skill.id) && !(c.skill.id === last && c.skill.id === prev));
    if (themed.length) {
      const [source, c] = themed[rng.weighted(themed.map(([, x]) => x.weight * (x.skill.id === last ? 0.3 : 1)))]!;
      return { skillId: c.skill.id, source };
    }
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
