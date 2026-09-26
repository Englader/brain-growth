/**
 * Mode registrations. Adding a mode = write its component and register it
 * here with the capabilities it needs. Home screens, the engine's skill
 * filter, achievements ("tried every mode") and flags all read the registry.
 */
import { GRAPH } from '../core/skills';
import { HopMode } from './hop/HopMode';
import { registerMode } from './registry';
import { SprintMode } from './sprint/SprintMode';
import { SPRINT_ITEMS } from './sprint/timing';

registerMode({
  id: 'hop',
  titleKey: 'mode.hop.title',
  descKey: 'mode.hop.desc',
  icon: 'hops',
  requires: ['numberLine'],
  bands: ['A', 'B', 'C'],
  plannedItems: (band, opts) => (opts.quick ? band.quickItems : band.sessionItems),
  Component: HopMode,
});

registerMode({
  id: 'sprint',
  titleKey: 'mode.sprint.title',
  descKey: 'mode.sprint.desc',
  icon: 'bolt',
  requires: ['numberLine', 'numeric'],
  bands: ['B', 'C'],
  flag: 'mode.sprint',
  timed: true,
  // Only fluency skills the child already holds at Solid or better: never new material.
  filter: (skill, state) => skill.tags.includes('fluency') && state?.proficientAt !== undefined,
  ready: (p) => GRAPH.playableSkills().some((s) => s.tags.includes('fluency') && p.skills[s.id]?.proficientAt !== undefined),
  notReadyKey: 'home.sprintLocked',
  plannedItems: () => SPRINT_ITEMS,
  maxReturns: () => 0,
  Component: SprintMode,
});
