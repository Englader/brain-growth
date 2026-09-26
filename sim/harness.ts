/** Drives SessionEngine with simulated learners on a simulated clock. */
import { glickoElo } from '../src/core/engine/glicko';
import { startPlacement } from '../src/core/engine/placement';
import { SessionEngine, type LearnerSnapshot } from '../src/core/engine/session';
import type { ItemRecord } from '../src/core/log/types';
import { createRng, type Rng } from '../src/core/rng';
import { GRAPH } from '../src/core/skills';
import type { NumberConventions } from '../src/i18n/numbers';
import { SimLearner } from './learner';

export const EN_CONV: NumberConventions = { bcp47: 'en-US', decimal: '.', group: ',', minimumGroupingDigits: 1, minus: '−' };

export class SimClock {
  constructor(public t = Date.UTC(2026, 8, 1, 15)) {}
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

export interface SimSessionResult {
  snapshot: LearnerSnapshot;
  records: ItemRecord[];
  firstAttempts: number;
  firstCorrect: number;
  placementWrong: number;
  placementDone: { g: number; sd: number } | null;
}

export function newSnapshot(age: number): LearnerSnapshot {
  return { skills: {}, placement: { done: false, state: startPlacement(age) } };
}

export function runSession(
  learner: SimLearner,
  snapshot: LearnerSnapshot,
  clock: SimClock,
  rng: Rng,
  opts: { items: number; targetP: number; seed: number; allowReading?: boolean },
): SimSessionResult {
  const engine = new SessionEngine(
    { graph: GRAPH, model: glickoElo, now: clock.now },
    snapshot,
    {
      sessionId: `sim-${opts.seed}`,
      seed: opts.seed,
      band: { id: 'B', targetP: opts.targetP, allowReading: opts.allowReading ?? true, maxReturns: 2 },
      mode: { id: 'hop', requires: ['numberLine'] },
      plannedItems: opts.items,
      stretch: false,
      timed: false,
    },
  );
  const records: ItemRecord[] = [];
  let placementWrong = 0;
  let placementDone: SimSessionResult['placementDone'] = null;
  for (;;) {
    const p = engine.next();
    if (!p) break;
    const { response } = learner.respond(p, rng);
    clock.advance(6_000 + rng.int(0, 6_000));
    const r = engine.answer(p, { response, latencyMs: 6000, hint: false, locale: 'en', conv: EN_CONV, input: 'typed' });
    if (r.record) records.push(r.record);
    if (p.source === 'placement' && r.record && !r.record.correct) placementWrong++;
    if (r.placementFinished) placementDone = r.placementFinished;
  }
  const first = records.filter((r) => r.attempt === 1);
  return {
    snapshot: engine.snapshot,
    records,
    firstAttempts: first.length,
    firstCorrect: first.filter((r) => r.correct).length,
    placementWrong,
    placementDone,
  };
}

export { createRng };
