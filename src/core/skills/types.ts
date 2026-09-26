import type { BandId, SkillId, Strand } from '../types';

export type SkillTag =
  /** Retrieval-fluency skill: eligible for timed (opt-in) practice once proficient. */
  | 'fluency'
  /** Needs reading; excluded for pre-readers (Band A presentation). */
  | 'reading'
  /** Primarily visual/spatial. */
  | 'visual'
  /** Answers are estimates with a tolerance. */
  | 'estimation';

export interface GeneratorBinding {
  id: string;
  config?: Record<string, unknown>;
  /** Relative sampling weight when a skill has several generators. */
  weight?: number;
}

export interface SkillDef {
  id: SkillId;
  strand: Strand;
  /**
   * Curriculum position on the North Macedonian 9-year primary sequence:
   * 0 = preschool (age 5), 1.0 = start of одделение 1, 3.5 = middle of одделение 3.
   */
  grade: number;
  /** Band membership is an attribute of the node; the graph itself is continuous. */
  band: BandId;
  prereqs: SkillId[];
  tags: SkillTag[];
  /** Absent ⇒ node is part of the graph (sequencing, docs, UI) but not yet playable. */
  gens?: GeneratorBinding[];
  /** Generator level that defines the mastery bar (default 0.75). */
  masteryLevel?: number;
}
