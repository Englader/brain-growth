/** Dev report: how well each generator tracks the requested level. `npx vite-node scripts/level-report.ts` */
import { GRAPH } from '../src/core/skills';
import { getGenerator, loadAllGenerators } from '../src/core/items/generators';
import { createRng } from '../src/core/rng';

// Feature modes' generators load on demand in the app; this report needs them all.
await loadAllGenerators();

for (const s of GRAPH.playableSkills()) {
  for (const g of s.gens ?? []) {
    const gen = getGenerator(g.id);
    const row = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      let sum = 0;
      for (let seed = 1; seed <= 60; seed++) sum += gen.generate(t, createRng(seed * 31 + t * 1000), g.config ?? {}).level;
      return (sum / 60).toFixed(2);
    });
    console.log(`${s.id.padEnd(24)} ${g.id.padEnd(10)} ${row.join('  ')}`);
  }
}
