/**
 * Dice Race (pass-and-play, DESIGN §1.4): two children on this device race on
 * their own lanes; every move is one of their own adaptive items. Standalone
 * (engine: false): it runs one session per player itself.
 */
import { canRace } from '../../app/diceActions';
import { getState } from '../../app/store';
import { registerMode } from '../registry';
import { DiceMode } from './DiceMode';
import { DiceSetup } from './DiceSetup';

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
  intro: DiceSetup,
  // At least two placed children who can race, this one included.
  ready: (p) => canRace(p) && getState().profiles.filter((x) => canRace(x)).length >= 2,
  notReadyKey: 'dice.notReady',
  Component: DiceMode,
});
