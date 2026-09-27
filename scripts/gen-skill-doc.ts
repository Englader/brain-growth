/**
 * Generates design/skill-graph.md from the catalog, so the documented graph
 * can never drift from the code (tests/generated-docs.test.ts enforces it).
 *   npm run gen:skill-doc
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAllLocales } from '../src/i18n/locales';
import { renderSkillGraphDoc, SKILL_GRAPH_DOC } from './docs';

await loadAllLocales();
const out = resolve(__dirname, '..', SKILL_GRAPH_DOC);
writeFileSync(out, renderSkillGraphDoc());
console.log(`wrote ${out}`);
