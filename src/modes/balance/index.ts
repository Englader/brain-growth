/**
 * Balance mode registration (step 9b): equations on a pan scale for
 * `al.eq.onestep` and `al.eq.linear`, Bands B and C. Ready once placement is
 * done and an equation skill is unlocked (a Band B child who has unlocked it
 * plays too; everyone else sees when it opens).
 */
import { isUnlocked } from '../../core/engine/scheduler';
import { GRAPH } from '../../core/skills';
import { registerMode } from '../registry';
import { BalanceMode } from './BalanceMode';

/** Skills this mode serves (bound to the `equation` generator in the catalog). */
export const BALANCE_SKILLS = ['al.eq.onestep', 'al.eq.linear'] as const;

registerMode({
  id: 'balance',
  order: 52,
  titleKey: 'balance.title',
  descKey: 'balance.desc',
  icon: 'scale',
  requires: ['build'],
  bands: ['B', 'C'],
  flag: 'mode.balance',
  // 'build' is shared with the coordinate plane and Workshop: serve equation items only.
  filter: (skill) => (skill.gens ?? []).some((b) => b.id === 'equation'),
  ready: (p) => p.placement.done && BALANCE_SKILLS.some((id) => GRAPH.has(id) && isUnlocked(GRAPH, id, p.skills)),
  notReadyKey: 'balance.locked',
  // An equation takes several moves: shorter sessions than Hop.
  plannedItems: (band, opts) => (opts.quick ? band.quickItems : 8),
  Component: BalanceMode,
});
