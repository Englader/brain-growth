/**
 * "No walls, ever" (DESIGN A-19, §1.3). Unlocking uses effective
 * prerequisites over the GLOBAL playable graph, but modes are per child and
 * can be switched off. So a skill that only some mode can serve (a Workshop
 * construction, a Target deal) must never be what another skill waits for:
 * every effective prerequisite of every playable skill must be servable by
 * Hop to a pre-reader (a numberLine binding without 'reading'). Mode-only
 * skills are therefore leaves.
 */
import { describe, expect, it } from 'vitest';
import { getGenerator } from '../src/core/items/generators';
import { GRAPH } from '../src/core/skills';
import { SkillGraph } from '../src/core/skills/graph';
import type { SkillDef } from '../src/core/skills/types';

function walls(graph: SkillGraph, capsOf: (genId: string) => readonly string[]): string[] {
  const hopServable = (id: string): boolean =>
    (graph.get(id).gens ?? []).some((b) => capsOf(b.id).includes('numberLine') && !capsOf(b.id).includes('reading'));
  const out: string[] = [];
  for (const s of graph.playableSkills()) for (const p of graph.effectivePrereqs(s.id)) if (!hopServable(p)) out.push(`${s.id} waits for ${p}`);
  return out;
}

describe('no walls', () => {
  it('every effective prerequisite of a playable skill is servable by Hop without reading', () => {
    expect(walls(GRAPH, (id) => getGenerator(id).capabilities)).toEqual([]);
  });

  it('reports a mode-only skill that another skill depends on', () => {
    const sk = (id: string, prereqs: string[], gen: string): SkillDef => ({ id, strand: 'number', grade: 1, band: 'A', prereqs, tags: [], gens: [{ id: gen }] });
    const caps: Record<string, string[]> = { hop: ['numberLine', 'numeric'], build: ['build'], word: ['numberLine', 'reading'] };
    const g = new SkillGraph([sk('a', [], 'hop'), sk('b', ['a'], 'build'), sk('c', ['b'], 'hop'), sk('d', ['a'], 'word'), sk('e', ['d'], 'hop')], (s) => !!s.gens);
    expect(walls(g, (id) => caps[id] ?? [])).toEqual(['c waits for b', 'e waits for d']);
  });
});
