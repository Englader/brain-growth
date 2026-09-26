import '../items/generators';
import { hasGenerator } from '../items/generators/registry';
import type { BandId } from '../types';
import { SKILLS } from './catalog';
import { SkillGraph } from './graph';

/** Curriculum windows per band: [from, to) in grade units. Engine-level fact, not presentation. */
export const BAND_GRADES: Record<BandId, [number, number]> = {
  A: [0, 3],
  B: [3, 7],
  C: [7, 10],
};

export const GRAPH = new SkillGraph(SKILLS, (s) => !!s.gens?.length && s.gens.every((g) => hasGenerator(g.id)));

export { SKILLS } from './catalog';
export type { SkillDef, SkillTag, GeneratorBinding } from './types';
export { SkillGraph } from './graph';
