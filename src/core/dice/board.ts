/**
 * Dice Race boards: one lane per player, shaped by that player's band.
 *
 *   A  pads 0…20                      one die of dots, always forward
 *   B  ruler 0…80 with 5 ladders      two dice combined with + − × (× unlocked)
 *      ruler 0…42 with 3 ladders      the same without × (+ and − only)
 *   C  integers −10…+15, start −10    number die 1–10 and a form die
 *
 * Lengths are tuned so the expected number of turns is about the same in
 * every band (≈ 6 turns; see `expectedTurns` in policy.ts and the Monte
 * Carlo check in tests/dice.test.ts),
 * so the dice, not the age gap, decide who reaches the pond first. Band B
 * needs two lengths because × roughly doubles the average move.
 */
import { fnv1a } from '../hash';
import { createRng } from '../rng';
import type { BandId } from '../types';
import type { Board, DiceOp, Ladder } from './types';

export interface LadderSpec {
  count: number;
  minClimb: number;
  maxClimb: number;
}

export interface LaneSpec {
  start: number;
  finish: number;
  floor: number;
  ladders: LadderSpec | null;
}

export const LANES = {
  A: { start: 0, finish: 20, floor: 0, ladders: null },
  /** Band B when × is among the child's operators. */
  B: { start: 0, finish: 80, floor: 0, ladders: { count: 5, minClimb: 10, maxClimb: 20 } },
  /** Band B with + and − only (× not unlocked yet). */
  Bplus: { start: 0, finish: 42, floor: 0, ladders: { count: 3, minClimb: 5, maxClimb: 10 } },
  C: { start: -10, finish: 15, floor: -10, ladders: null },
} as const satisfies Record<string, LaneSpec>;

/** No ladder foot closer to the start than this (the first roll is plain maths). */
export const LADDER_START_GAP = 3;
/** No ladder top closer to the finish than this (the last stretch is plain maths). */
export const LADDER_FINISH_GAP = 4;
/** Minimum distance between two ladder feet. */
export const LADDER_FOOT_GAP = 3;

export function laneSpec(band: BandId, ops: readonly DiceOp[] = ['+', '-', '*']): LaneSpec {
  if (band === 'B') return ops.includes('*') ? LANES.B : LANES.Bplus;
  return LANES[band];
}

/** Every rule a ladder set must satisfy (used by placement and by the tests). */
export function laddersValid(ladders: readonly Ladder[], spec: LaneSpec): boolean {
  if (!spec.ladders) return ladders.length === 0;
  const { count, minClimb, maxClimb } = spec.ladders;
  if (ladders.length !== count) return false;
  const feet = new Set(ladders.map((l) => l.foot));
  const tops = new Set(ladders.map((l) => l.top));
  if (feet.size !== count || tops.size !== count) return false;
  for (let i = 0; i < ladders.length; i++) {
    const l = ladders[i]!;
    const climb = l.top - l.foot;
    if (climb < minClimb || climb > maxClimb) return false;
    if (l.foot < spec.start + LADDER_START_GAP || l.top > spec.finish - LADDER_FINISH_GAP) return false;
    if (feet.has(l.top)) return false; // no chains: a top is never another foot
    if (i > 0 && l.foot - ladders[i - 1]!.foot < LADDER_FOOT_GAP) return false;
  }
  return true;
}

function tryPlace(spec: LaneSpec, seed: number, attempt: number): Ladder[] {
  const ls = spec.ladders!;
  const rng = createRng(fnv1a(`dice.ladders|${spec.finish}|${seed}|${attempt}`));
  const lo = spec.start + LADDER_START_GAP;
  const hi = spec.finish - LADDER_FINISH_GAP - ls.minClimb;
  const width = (hi - lo + 1) / ls.count;
  // One foot per equal segment keeps ladders spread along the whole lane.
  const feet: number[] = [];
  for (let i = 0; i < ls.count; i++) {
    const segLo = lo + Math.ceil(i * width);
    const segHi = Math.max(segLo, lo + Math.ceil((i + 1) * width) - LADDER_FOOT_GAP);
    feet.push(rng.int(segLo, Math.min(segHi, hi)));
  }
  const tops = new Set<number>();
  const out: Ladder[] = [];
  for (const foot of feet) {
    const maxClimb = Math.min(ls.maxClimb, spec.finish - LADDER_FINISH_GAP - foot);
    const climbs = rng.shuffle(Array.from({ length: maxClimb - ls.minClimb + 1 }, (_, i) => ls.minClimb + i));
    const climb = climbs.find((c) => !feet.includes(foot + c) && !tops.has(foot + c));
    if (climb === undefined) return [];
    tops.add(foot + climb);
    out.push({ foot, top: foot + climb });
  }
  return out;
}

/** Evenly spaced, minimum-climb ladders: a valid layout for any sane spec. */
function fallbackLadders(spec: LaneSpec): Ladder[] {
  const ls = spec.ladders!;
  const lo = spec.start + LADDER_START_GAP;
  const hi = spec.finish - LADDER_FINISH_GAP - ls.minClimb;
  const step = (hi - lo) / Math.max(1, ls.count - 1);
  return Array.from({ length: ls.count }, (_, i) => {
    const foot = lo + Math.round(i * step);
    return { foot, top: foot + ls.minClimb };
  });
}

export function placeLadders(spec: LaneSpec, seed: number): Ladder[] {
  if (!spec.ladders) return [];
  for (let attempt = 0; attempt < 50; attempt++) {
    const ladders = tryPlace(spec, seed, attempt);
    if (laddersValid(ladders, spec)) return ladders;
  }
  return fallbackLadders(spec);
}

/**
 * The lane for a band. Deterministic: the same (band, seed, ops) always gives
 * the same board, so a match can be rebuilt from its seed. `ops` only matters
 * for Band B (whether × is available picks the lane length).
 */
export function boardFor(band: BandId, seed: number, ops?: readonly DiceOp[]): Board {
  const spec = laneSpec(band, ops);
  return {
    band,
    start: spec.start,
    finish: spec.finish,
    floor: spec.floor,
    ladders: placeLadders(spec, seed),
    seed,
  };
}

export function ladderAt(board: Board, square: number): Ladder | null {
  return board.ladders.find((l) => l.foot === square) ?? null;
}
