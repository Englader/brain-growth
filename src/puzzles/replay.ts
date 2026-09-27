/**
 * The `puzzle` log event, the live transition that emits it, and the replay
 * that rebuilds every per-type rating from those events. Live play and replay
 * both go through `applyPuzzleResult`, so they cannot drift apart.
 */
import { EVENTS, type LogRecord } from '../core/log/types';
import type { BandId, LocaleId } from '../core/types';
import { applyPuzzleResult, puzzlePrior, puzzleY, type PuzzleOutcome, type PuzzleRatings } from './rating';
import type { StartedPuzzle } from './select';

/** Event name of a finished puzzle (EVENTS.PUZZLE). */
export const PUZZLE_EVENT: string = EVENTS.PUZZLE;

/** Payload of the `puzzle` event. Plain JSON. */
export interface PuzzleEvent {
  type: string;
  /** Puzzle type version. */
  v: number;
  seed: number;
  /** Achieved level and its logit difficulty (the rating update uses `diff`). */
  level: number;
  diff: number;
  /** Predicted P(solved without help) before the outcome (calibration). */
  p: number;
  /** Outcome used for the rating. */
  y: number;
  /** Solved by the child's own answer (false = revealed or given up). */
  solved: boolean;
  /** Hint rungs used. */
  hints: number;
  /** Checks that failed ("not yet"). */
  checks: number;
  band: BandId;
  locale: LocaleId;
  /** When the puzzle was SHOWN (ms). */
  ts: number;
  /** Requested level: `generate(createRng(seed), band, req)` rebuilds the exact puzzle. */
  req?: number;
  /** Target success probability asked for (0.75, or 0.55 for "Harder one"). */
  target?: number;
  /** Time spent (ms). Logged for analysis only; never read by the rating. */
  ms?: number;
  /** School year the puzzle was chosen for (DESIGN A-29); absent when none was. Never read by the rating. */
  year?: number;
  /**
   * Violated-constraint ids of each failed check, joined by '+', in order
   * (e.g. ["below", "wide+above"]). Precise here even where the child only
   * saw a neutral message (estimates never show a direction).
   */
  fails?: string[];
}

/**
 * Finish a puzzle: update its type's rating and build the event to log.
 * Call once per puzzle, when it is solved or revealed.
 */
export function finishPuzzle(
  ratings: PuzzleRatings,
  started: StartedPuzzle<unknown>,
  outcome: PuzzleOutcome,
  locale: LocaleId,
): { ratings: PuzzleRatings; event: PuzzleEvent } {
  const y = puzzleY(outcome);
  const event: PuzzleEvent = {
    type: started.type,
    v: started.v,
    seed: started.seed,
    level: started.level,
    diff: started.diff,
    p: started.p,
    y,
    solved: outcome.solved,
    hints: outcome.hints,
    checks: outcome.wrongChecks,
    band: started.band,
    locale,
    ts: started.ts,
    req: started.req,
    target: started.target,
    ...(started.year !== undefined ? { year: started.year } : {}),
    ...(outcome.ms !== undefined ? { ms: outcome.ms } : {}),
    ...(outcome.fails?.length ? { fails: [...outcome.fails] } : {}),
  };
  const obs = { y, diff: started.diff, ts: started.ts, solved: outcome.solved };
  return { ratings: applyPuzzleResult(ratings, started.type, obs, puzzlePrior(started.band)), event };
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A well-formed puzzle event from untrusted JSON (a log record's data), or null. */
export function parsePuzzleEvent(data: unknown, fallbackTs?: number): PuzzleEvent | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const ts = finite(d.ts) ? d.ts : fallbackTs;
  if (typeof d.type !== 'string' || !finite(d.diff) || !finite(ts) || typeof d.solved !== 'boolean') return null;
  const hints = finite(d.hints) ? d.hints : 0;
  const checks = finite(d.checks) ? d.checks : 0;
  return {
    type: d.type,
    v: finite(d.v) ? d.v : 0,
    seed: finite(d.seed) ? d.seed : 0,
    level: finite(d.level) ? d.level : 0,
    diff: d.diff,
    p: finite(d.p) ? d.p : 0,
    y: finite(d.y) ? d.y : puzzleY({ solved: d.solved, hints, wrongChecks: checks }),
    solved: d.solved,
    hints,
    checks,
    band: d.band === 'A' || d.band === 'B' || d.band === 'C' ? d.band : 'B',
    locale: typeof d.locale === 'string' ? d.locale : '',
    ts,
    ...(finite(d.req) ? { req: d.req } : {}),
    ...(finite(d.target) ? { target: d.target } : {}),
    ...(finite(d.year) ? { year: d.year } : {}),
    ...(finite(d.ms) ? { ms: d.ms } : {}),
    ...(Array.isArray(d.fails) ? { fails: d.fails.map(String) } : {}),
  };
}

/** Puzzle events from a session log (records named PUZZLE_EVENT; payload ts preferred). */
export function puzzleEventsFromLog(records: readonly LogRecord[]): PuzzleEvent[] {
  const out: PuzzleEvent[] = [];
  for (const r of records) {
    if (r.type !== 'event' || r.name !== PUZZLE_EVENT) continue;
    const e = parsePuzzleEvent(r.data, r.ts);
    if (e) out.push(e);
  }
  return out;
}

/**
 * Rebuild every per-type rating from puzzle events, in time order (stable for
 * ties). The outcome is recomputed from the logged facts (solved, hints,
 * checks) with the same formula live play used; `diff` and `ts` are taken as
 * logged. Malformed payloads are skipped.
 */
export function replayPuzzleRatings(events: readonly unknown[]): PuzzleRatings {
  const parsed = events
    .map((e, i) => ({ e: parsePuzzleEvent(e), i }))
    .filter((x): x is { e: PuzzleEvent; i: number } => x.e !== null)
    .sort((a, b) => a.e.ts - b.e.ts || a.i - b.i);
  let ratings: PuzzleRatings = {};
  for (const { e } of parsed) {
    const y = puzzleY({ solved: e.solved, hints: e.hints, wrongChecks: e.checks });
    ratings = applyPuzzleResult(ratings, e.type, { y, diff: e.diff, ts: e.ts, solved: e.solved }, puzzlePrior(e.band));
  }
  return ratings;
}
