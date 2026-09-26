/**
 * Achievements are DATA: a condition tree over named metrics. Metrics are the
 * extensible vocabulary (one registered function each), evaluated against the
 * profile and the session log. Adding an achievement is usually one entry in
 * definitions.ts plus its strings; adding a metric is one function.
 */
import type { SkillGraph } from '../skills/graph';
import type { LogRecord } from '../log/types';
import type { Profile } from '../profile';
import type { BandId } from '../types';

export type AchievementCategory = 'mastery' | 'persistence' | 'exploration' | 'resilience' | 'discovery';

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { metric: string; params?: Record<string, string | number>; gte?: number; lte?: number; eq?: number };

export type Trigger = 'item' | 'session' | 'open';

export interface AchievementDef {
  id: string;
  category: AchievementCategory;
  bands: readonly BandId[] | 'all';
  /** Secret achievements are invisible until found (shown only as a count). */
  secret?: boolean;
  icon: string;
  when: Condition;
  on: readonly Trigger[];
}

/**
 * What a metric measures. The reward-design guard (tests/achievements.test.ts)
 * rejects any achievement whose conditions use only 'correctness' metrics:
 * nothing is ever awarded for raw correctness rate alone.
 */
export type MetricKind = 'effort' | 'correctness' | 'mastery' | 'exploration' | 'resilience' | 'streak' | 'discovery';

export interface EvalContext {
  profile: Profile;
  now: number;
  today: string;
  /** Recent log window (≤ 120 days), chronological. */
  log: readonly LogRecord[];
  /** Id of the session being evaluated, if any. */
  sessionId: string | null;
  graph: SkillGraph;
  /** Number of game modes enabled for this profile (for "tried every mode"). */
  modesAvailable: number;
  memo: Map<string, unknown>;
}

export interface MetricDef {
  id: string;
  kind: MetricKind;
  compute(ctx: EvalContext, params: Record<string, string | number>): number;
}
