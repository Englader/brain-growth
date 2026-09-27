/**
 * Coordinate-plane mode registration (step 9c): plot and read lattice points
 * for `geo.coord`. Band C, and Band B once the skill is unlocked (the card
 * says when it opens until then).
 */
import { isUnlocked } from '../../core/engine/scheduler';
import { GRAPH } from '../../core/skills';
import { registerMode } from '../registry';
import { CoordMode } from './CoordMode';

registerMode({
  id: 'coord',
  order: 54,
  titleKey: 'coord.title',
  descKey: 'coord.desc',
  icon: 'axes',
  requires: ['build'],
  bands: ['B', 'C'],
  flag: 'mode.coord',
  // 'build' is shared with Balance and Workshop: serve coordinate items only.
  filter: (skill) => (skill.gens ?? []).some((b) => b.id === 'coord'),
  ready: (p) => p.placement.done && GRAPH.has('geo.coord') && isUnlocked(GRAPH, 'geo.coord', p.skills),
  notReadyKey: 'coord.locked',
  plannedItems: (band, opts) => (opts.quick ? band.quickItems : 10),
  Component: CoordMode,
});
