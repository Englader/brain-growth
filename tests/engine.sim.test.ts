/**
 * Simulated-learner acceptance tests for the adaptive engine. These pin the
 * behaviour promised in DESIGN.md §1.5–1.6 against a deliberately
 * misspecified population (see sim/learner.ts).
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { GRAPH } from '../src/core/skills';
import { DAY_MS } from '../src/core/time';
import { newSnapshot, runSession, SimClock } from '../sim/harness';
import { randomLearner } from '../sim/learner';

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('cold-start placement (≤ 8 items, inside the first ordinary session)', () => {
  it('places children within one grade of their true position', () => {
    const rng = createRng(2024);
    const errs: number[] = [];
    const wrong: number[] = [];
    const used: number[] = [];
    for (let i = 0; i < 150; i++) {
      const learner = randomLearner(rng, GRAPH, [0.3, 4.2]);
      const age = Math.round(learner.params.g + 5 + rng.normal() * 0.8);
      const r = runSession(learner, newSnapshot(age), new SimClock(), rng, { items: 10, targetP: 0.85, seed: i + 7 });
      expect(r.placementDone).not.toBeNull();
      errs.push(Math.abs(r.placementDone!.g - learner.params.g));
      wrong.push(r.placementWrong);
      used.push(r.records.filter((x) => x.source === 'placement').length);
    }
    expect(Math.max(...used)).toBeLessThanOrEqual(8);
    expect(mean(errs)).toBeLessThan(0.6);
    expect(errs.filter((e) => e <= 1).length / errs.length).toBeGreaterThan(0.85);
    // It must not feel like a test: most placement items are answered correctly.
    expect(mean(wrong) / mean(used)).toBeLessThan(0.36);
  });
});

describe('item selection hits the target success rate', () => {
  it('realised first-attempt success stays near 85% over four weeks', () => {
    const rng = createRng(77);
    const rates: number[] = [];
    for (let i = 0; i < 40; i++) {
      const learner = randomLearner(rng, GRAPH, [0.5, 3.5]);
      const clock = new SimClock();
      let snap = newSnapshot(Math.round(learner.params.g + 5));
      let fa = 0;
      let fc = 0;
      for (let day = 0; day < 28; day++) {
        const r = runSession(learner, snap, clock, rng, { items: 12, targetP: 0.85, seed: 100 * i + day });
        snap = r.snapshot;
        if (day > 0) {
          fa += r.firstAttempts;
          fc += r.firstCorrect;
        }
        clock.advance(DAY_MS - 120_000);
      }
      rates.push(fc / fa);
    }
    expect(mean(rates)).toBeGreaterThan(0.8);
    expect(mean(rates)).toBeLessThan(0.9);
    expect(Math.min(...rates)).toBeGreaterThan(0.7);
  });
});
