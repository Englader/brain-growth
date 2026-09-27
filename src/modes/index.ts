/**
 * Mode registrations. Hop and Sprint register here; every other mode
 * registers itself in its own `src/modes/<id>/index.ts` and is pulled in by
 * one side-effect import under its slot below (CONTRIBUTING: "Parallel work
 * conventions"). Home screens, routes, the engine's skill filter, "tried
 * every mode" and flags all read the registry.
 *
 * Registrations are eager (cards, readiness and flags work at once); every
 * mode screen except Hop's is a chunk loaded on first use (./lazy.tsx).
 */
import { GRAPH } from '../core/skills';
import { HopMode } from './hop/HopMode';
import { lazyScreen } from './lazy';
import { registerMode } from './registry';
import { SPRINT_ITEMS } from './sprint/timing';

// Feature modes: one side-effect import (`import './<id>';`) directly under its own anchor. Never reorder.
// ── slot: frac ──
// ── slot: hint ──
// ── slot: pilot ──
// ── slot: storage ──
// ── slot: weekly ──
// ── slot: target ──
import './target';
// ── slot: dice ──
// ── slot: puzzle ──
import './puzzle';
// ── slot: workshop ──
// ── slot: balance ──
import './balance';
// ── slot: coord ──
import './coord';
// ── slot: season ──

registerMode({
  id: 'hop',
  order: 0,
  titleKey: 'mode.hop.title',
  descKey: 'mode.hop.desc',
  icon: 'hops',
  requires: ['numberLine'],
  bands: ['A', 'B', 'C'],
  placement: true,
  Component: HopMode,
});

registerMode({
  id: 'sprint',
  order: 10,
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
  // Its own chunk (./lazy): the intro and the race screen load when the card is opened.
  intro: lazyScreen(() => import('./sprint/SprintMode').then((m) => m.SprintIntro)),
  Component: lazyScreen(() => import('./sprint/SprintMode').then((m) => m.SprintMode), { placeholderClass: 'play lazy-screen' }),
});
