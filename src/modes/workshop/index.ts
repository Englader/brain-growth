/**
 * Registers the Workshop mode (plan step 9a): fractions and area/perimeter by
 * direct manipulation. Ships ON (DESIGN A-26); `mode.workshop` stays a
 * per-child switch in the adult view.
 *
 * It serves only the Workshop generators (fraction bar, rectangle builder):
 * the 'build' capability is shared with Balance and Coord, so the skill
 * filter narrows it to skills bound to a Workshop generator. Evidence weight
 * 0.75 (MODE_EVIDENCE): a construction found against a live readout is
 * noisier evidence than a typed answer.
 *
 * The board is a chunk loaded on first use (lazyScreen) and the two
 * generators load on demand with it (ON_DEMAND in generators/index.ts); this
 * module holds only what the home card needs.
 */
import type { BandId } from '../../core/types';
import { isUnlocked } from '../../core/engine/scheduler';
import type { Profile } from '../../core/profile';
import { GRAPH } from '../../core/skills';
import type { SkillDef } from '../../core/skills/types';
import { lazyScreen } from '../lazy';
import { registerMode } from '../registry';

/** Generator ids of the Workshop (generators/workshop.ts: FRAC_BAR_GEN, RECT_GEN). */
const WORKSHOP_GEN_IDS: ReadonlySet<string> = new Set(['fracBar', 'rectBuild']);

/** A skill the Workshop can serve: bound to one of its generators. */
export const isWorkshopSkill = (s: SkillDef): boolean => (s.gens ?? []).some((b) => WORKSHOP_GEN_IDS.has(b.id));

/** The playable skills the Workshop serves (fraction bar: f.unit, f.equiv; rectangles: geo.perimeter, geo.area.rect). */
export const workshopSkills = (): SkillDef[] => GRAPH.playableSkills().filter(isWorkshopSkill);

/** Ready once placement is done and one of its skills is unlocked for this child. */
export const workshopReady = (p: Profile): boolean => p.placement.done && workshopSkills().some((s) => isUnlocked(GRAPH, s.id, p.skills));

/** First presentations per session: a construction takes longer than a typed answer. */
export const WORKSHOP_ITEMS: Record<BandId, number> = { A: 4, B: 6, C: 8 };

registerMode({
  id: 'workshop',
  order: 50,
  titleKey: 'workshop.title',
  descKey: 'workshop.desc',
  icon: 'shapes',
  requires: ['build'],
  bands: ['B', 'C'],
  flag: 'mode.workshop',
  // 'build' is shared with Balance and the coordinate plane: serve fraction bars and rectangles only.
  filter: (skill) => isWorkshopSkill(skill),
  ready: workshopReady,
  notReadyKey: 'workshop.notReady',
  plannedItems: (band, opts) => (opts.quick ? band.quickItems : WORKSHOP_ITEMS[band.id]),
  // Its own chunk: the boards load when the mode opens.
  Component: lazyScreen(() => import('./WorkshopMode').then((m) => m.WorkshopMode), { placeholderClass: 'play ws-play lazy-screen' }),
});
