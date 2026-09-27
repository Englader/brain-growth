/**
 * Puzzle-track metrics (plan §4 step 8). None measures accuracy: a puzzle is
 * "solved" however many checks and hints it took (checks are unlimited and
 * never time out), so these count finished thinking, not correctness rate.
 * Lifetime counts come from the per-type ratings on the profile, which merge
 * monotonically across devices and outlive the 120-day log window.
 */
import { EVENTS } from '../../log/types';
import { registerMetric } from '../metrics';
import type { EvalContext } from '../types';

/** Target success probability of the "Harder one" chip (src/puzzles/select.ts PUZZLE_TARGET.HARDER). */
const HARDER_TARGET = 0.55;

const solvedOf = (c: EvalContext, type?: string): number =>
  Object.entries(c.profile.puzzles ?? {}).reduce((n, [t, r]) => n + (type === undefined || t === type ? r.solved : 0), 0);

registerMetric({ id: 'puzzle.solved', kind: 'effort', compute: (c) => solvedOf(c) });

registerMetric({
  id: 'puzzle.solvedHarder',
  kind: 'exploration',
  compute: (c) =>
    c.log.filter(
      (r) =>
        r.type === 'event' &&
        r.name === EVENTS.PUZZLE &&
        r.data?.solved === true &&
        typeof r.data.target === 'number' &&
        r.data.target <= HARDER_TARGET + 1e-9,
    ).length,
});

registerMetric({ id: 'puzzle.estimatesSolved', kind: 'exploration', compute: (c) => solvedOf(c, 'estimate') });
