/** Registers the built-in generators. Import this module once at start-up. */
import { addSubGen } from './addsub';
import { intAddSubGen } from './integers';
import { divGen, groupsGen, mult10sGen, multGen, multMultiGen } from './muldiv';
import { blocksGen, bondsGen, countGen, locateGen } from './number';
import { hasGenerator, registerGenerator } from './registry';
import { wordGen } from './word';

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
];

for (const g of BUILTIN) if (!hasGenerator(g.id)) registerGenerator(g);

export { getGenerator, hasGenerator, allGenerators } from './registry';
