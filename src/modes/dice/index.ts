/**
 * Dice Race (pass-and-play, DESIGN §1.4, §1.10): two children on this device
 * race on their own lanes; every move is one of their own adaptive items.
 * Standalone (engine: false): it runs one session per player itself.
 *
 * Only what the home card needs lives here (src/modes/lazy.tsx): the setup
 * and race screens, the race rules (src/core/dice) and the match actions are
 * one chunk, loaded when the mode opens. The items come from the built-in
 * add/sub, integer and times-table generators, so nothing loads on demand.
 */
import { getState } from '../../app/store';
import { isEnabled } from '../../core/flags';
import type { Profile } from '../../core/profile';
import { lazyScreen } from '../lazy';
import { registerMode } from '../registry';

/** A child who can race: placement done and Dice Race not switched off for them. */
export function canRace(p: Profile, deviceFlags: Record<string, boolean> = getState().meta?.deviceFlags ?? {}): boolean {
  return p.placement.done && isEnabled('mode.dice', p.flags, deviceFlags);
}

registerMode({
  id: 'dice',
  order: 30,
  titleKey: 'dice.title',
  descKey: 'dice.desc',
  icon: 'dice',
  requires: ['numberLine'],
  bands: ['A', 'B', 'C'],
  flag: 'mode.dice',
  engine: false,
  homeA: true,
  // At least two children who can race, this one included.
  ready: (p) => canRace(p) && getState().profiles.filter((x) => canRace(x)).length >= 2,
  notReadyKey: 'dice.notReady',
  intro: lazyScreen(() => import('./DiceSetup').then((m) => m.DiceSetup)),
  Component: lazyScreen(() => import('./DiceMode').then((m) => m.DiceMode), { placeholderClass: 'play lazy-screen' }),
});
