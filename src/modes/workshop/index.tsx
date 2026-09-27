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
 * The board UI is a separate chunk, loaded when the mode opens (the service
 * worker precaches every chunk, so it works offline). The generators stay in
 * the main bundle: the engine generates items synchronously.
 */
import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { BandId } from '../../core/types';
import { isUnlocked } from '../../core/engine/scheduler';
import { WORKSHOP_GENERATORS } from '../../core/items/generators/workshop';
import type { Profile } from '../../core/profile';
import { GRAPH } from '../../core/skills';
import type { SkillDef } from '../../core/skills/types';
import { registerMode } from '../registry';

let loaded: ComponentType | null = null;

function WorkshopModeLazy(): JSX.Element {
  const [C, setC] = useState<ComponentType | null>(() => loaded);
  useEffect(() => {
    if (C) return undefined;
    let live = true;
    void import('./WorkshopMode').then((m) => {
      loaded = m.WorkshopMode;
      if (live) setC(() => m.WorkshopMode);
    });
    return () => {
      live = false;
    };
  }, []);
  return C ? <C /> : <div class="play ws-play" />;
}

/** A skill the Workshop can serve: bound to one of its generators. */
export const isWorkshopSkill = (s: SkillDef): boolean => (s.gens ?? []).some((b) => WORKSHOP_GENERATORS.has(b.id));

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
  icon: 'grid',
  requires: ['build'],
  bands: ['B', 'C'],
  flag: 'mode.workshop',
  filter: (skill) => isWorkshopSkill(skill),
  ready: workshopReady,
  notReadyKey: 'workshop.notReady',
  plannedItems: (band, opts) => (opts.quick ? band.quickItems : WORKSHOP_ITEMS[band.id]),
  Component: WorkshopModeLazy,
});
