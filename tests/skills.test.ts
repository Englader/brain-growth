import { describe, expect, it } from 'vitest';
import { BAND_GRADES, GRAPH, SKILLS } from '../src/core/skills';
import { getGenerator } from '../src/core/items/generators';
import { createRng } from '../src/core/rng';
import { evalExpr } from '../src/core/items/util';
import { toNumber } from '../src/core/rational';
import type { GeneratedItem } from '../src/core/items/types';

describe('skill graph', () => {
  it('is a valid DAG consistent with band grade windows', () => {
    expect(GRAPH.validate(BAND_GRADES)).toEqual([]);
  });

  it('covers every school year with 6–12 skills (preschool may have fewer)', () => {
    const perGrade = new Map<number, number>();
    for (const s of SKILLS) perGrade.set(Math.floor(s.grade), (perGrade.get(Math.floor(s.grade)) ?? 0) + 1);
    for (let g = 1; g <= 9; g++) {
      const n = perGrade.get(g) ?? 0;
      expect(n, `grade ${g}`).toBeGreaterThanOrEqual(6);
      expect(n, `grade ${g}`).toBeLessThanOrEqual(12);
    }
  });

  it('has a playable branch crossing the A→B boundary and the B→C boundary', () => {
    const crossing = (from: string, to: string): boolean =>
      SKILLS.some(
        (s) => s.band === to && GRAPH.isPlayable(s.id) && GRAPH.effectivePrereqs(s.id).some((p) => GRAPH.get(p).band === from),
      );
    expect(crossing('A', 'B')).toBe(true);
    expect(crossing('B', 'C')).toBe(true);
  });

  it('never gates a playable skill on an unplayable one', () => {
    for (const s of GRAPH.playableSkills()) {
      for (const p of GRAPH.effectivePrereqs(s.id)) expect(GRAPH.isPlayable(p)).toBe(true);
    }
  });
});

function checkItem(item: GeneratedItem, label: string): void {
  const ans = toNumber(item.answer.value);
  const { line, prompt } = item;
  expect(line.min, label).toBeLessThanOrEqual(line.start);
  expect(line.start, label).toBeLessThanOrEqual(line.max);
  if (line.answerMode === 'land') {
    expect(ans, `${label} answer inside line`).toBeGreaterThanOrEqual(line.min);
    expect(ans, `${label} answer inside line`).toBeLessThanOrEqual(line.max);
  } else {
    expect(line.flag, label).toBeDefined();
    expect(line.start + ans * (line.hopSize ?? 1), `${label} count reaches flag`).toBe(line.flag);
  }
  // The answer must follow from the prompt.
  switch (prompt.kind) {
    case 'expr':
      if (prompt.rhs) {
        const rhs = evalExpr(prompt.rhs);
        const e = prompt.expr;
        if (e.k === 'op' && e.a.k === 'num' && e.b.k === 'blank') expect(e.a.v + ans, label).toBe(rhs);
      } else expect(evalExpr(prompt.expr), label).toBeCloseTo(ans, 9);
      break;
    case 'count':
      expect(prompt.count).toBe(ans);
      break;
    case 'locate':
      expect(prompt.target).toBe(ans);
      break;
    case 'blocks':
      expect(prompt.hundreds * 100 + prompt.tens * 10 + prompt.ones).toBe(ans);
      break;
    case 'groups':
      expect(prompt.groups * prompt.size).toBe(ans);
      break;
    case 'word':
      expect(Object.keys(prompt.vars).sort()).toEqual(['a', 'b']);
      break;
  }
  // Worked-solution hops are contiguous and end at the answer (land) or the flag (count).
  const hops = item.solution.filter((s): s is Extract<typeof s, { k: 'hop' }> => s.k === 'hop');
  if (hops.length) {
    for (let i = 1; i < hops.length; i++) expect(hops[i]!.from, `${label} hops contiguous`).toBe(hops[i - 1]!.to);
    const end = hops[hops.length - 1]!.to;
    expect(end, `${label} hops end`).toBe(line.answerMode === 'land' ? ans : line.flag);
  }
  expect(item.misconceptions.map((m) => m.value)).not.toContain(ans);
  expect(item.level).toBeGreaterThanOrEqual(0);
  expect(item.level).toBeLessThanOrEqual(1);
}

describe('generators', () => {
  const bindings = GRAPH.playableSkills().flatMap((s) => (s.gens ?? []).map((g) => ({ skill: s.id, g })));

  for (const { skill, g } of bindings) {
    it(`${skill} via ${g.id} produces valid, deterministic, level-tracking items`, () => {
      const gen = getGenerator(g.id);
      const meanLevel: number[] = [];
      for (const target of [0, 0.25, 0.5, 0.75, 1]) {
        let sum = 0;
        for (let seed = 1; seed <= 40; seed++) {
          const item = gen.generate(target, createRng(seed * 7919 + Math.round(target * 100)), g.config ?? {});
          checkItem(item, `${skill}@${target}#${seed}`);
          sum += item.level;
        }
        meanLevel.push(sum / 40);
      }
      // Determinism: same seed ⇒ identical item.
      const a = gen.generate(0.5, createRng(42), g.config ?? {});
      const b = gen.generate(0.5, createRng(42), g.config ?? {});
      expect(a).toEqual(b);
      // Level control: harder requests yield harder items on average.
      expect(meanLevel[4]! - meanLevel[0]!, `${skill} level span ${meanLevel.map((x) => x.toFixed(2))}`).toBeGreaterThan(0.3);
      for (let i = 1; i < meanLevel.length; i++) {
        expect(meanLevel[i]! + 0.05, `${skill} monotone ${meanLevel.map((x) => x.toFixed(2))}`).toBeGreaterThanOrEqual(meanLevel[i - 1]!);
      }
    });
  }
});
