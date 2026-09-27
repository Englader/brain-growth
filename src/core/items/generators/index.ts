/**
 * Registers the built-in generators and declares the on-demand ones. Import
 * this module once at start-up.
 *
 * BUILTIN generators are in the start-up bundle (Hop, placement, Sprint and
 * Dice Race serve them). A feature mode's own generators go in ON_DEMAND:
 * declared here by id and capabilities, their module fetched with the mode
 * (registry.ts, "On-demand generators"). Keep each declaration's capabilities
 * equal to the definition's; loading checks it.
 */
import { addSubGen } from './addsub';
import { intAddSubGen } from './integers';
import { divGen, groupsGen, mult10sGen, multGen, multMultiGen } from './muldiv';
import { blocksGen, bondsGen, countGen, locateGen } from './number';
import { declareGenerators, hasGenerator, registerGenerator, type OnDemandGenerators } from './registry';
import { wordGen } from './word';
// Feature generator imports, each under its own anchor:
// ── slot: frac ──
import { decAddSubGen, decLineGen, percentOfGen } from './decimals';
import { fracLineGen } from './fractions';
// ── slot: hint ──
// ── slot: pilot ──
// ── slot: storage ──
// ── slot: weekly ──
// ── slot: target ──
// ── slot: dice ──
// ── slot: puzzle ──
// ── slot: workshop ──
// ── slot: balance ──
import { eqBondGen } from './eqBond';
// ── slot: coord ──
// ── slot: season ──

const BUILTIN = [
  countGen,
  locateGen,
  blocksGen,
  bondsGen,
  addSubGen,
  groupsGen,
  multGen,
  divGen,
  mult10sGen,
  multMultiGen,
  intAddSubGen,
  wordGen,
  // Feature generators, each under its own anchor:
  // ── slot: frac ──
  fracLineGen,
  decLineGen,
  decAddSubGen,
  percentOfGen,
  // ── slot: hint ──
  // ── slot: pilot ──
  // ── slot: storage ──
  // ── slot: weekly ──
  // ── slot: target ──
  // ── slot: dice ──
  // ── slot: puzzle ──
  // ── slot: workshop ──
  // ── slot: balance ──
  // Hop serves al.eq.onestep as a missing number (no walls), so this one is eager.
  eqBondGen,
  // ── slot: coord ──
  // ── slot: season ──
];

for (const g of BUILTIN) if (!hasGenerator(g.id)) registerGenerator(g);

/** Feature modes' generators, fetched with their mode: `{ declared: [{ id, capabilities }], load: () => import(…) }`. */
const ON_DEMAND: OnDemandGenerators[] = [
  // ── slot: frac ──
  // ── slot: hint ──
  // ── slot: pilot ──
  // ── slot: storage ──
  // ── slot: weekly ──
  // ── slot: target ──
  {
    declared: [
      { id: 'makeTen', capabilities: ['deal', 'numeric'] },
      { id: 'makeIt', capabilities: ['deal', 'numeric', 'reading'] },
    ],
    load: () => import('./makeIt').then((m) => [m.makeTenGen, m.makeItGen]),
  },
  // ── slot: dice ──
  // ── slot: puzzle ──
  // ── slot: workshop ──
  // ── slot: balance ──
  { declared: [{ id: 'equation', capabilities: ['build'] }], load: () => import('./equation').then((m) => [m.equationGen]) },
  // ── slot: coord ──
  { declared: [{ id: 'coord', capabilities: ['build'] }], load: () => import('./coord').then((m) => [m.coordGen]) },
  // ── slot: season ──
];

for (const group of ON_DEMAND) declareGenerators(group);

export { allGenerators, generatorLoaded, generatorsReadyFor, getGenerator, hasGenerator, loadAllGenerators, loadGeneratorsFor } from './registry';
