/**
 * A pass-and-play match: players take turns in a fixed order, each on their
 * own lane. The match ends at the end of the round in which someone reaches
 * the pond, so everyone always gets the same number of turns and ties are
 * possible (and celebrated). No winner, place or score is stored or returned:
 * the summary is one celebratory line per player.
 *
 * The state is plain JSON. Each roll's randomness is derived from the match
 * seed and the roll counter, so a reload replays the same dice.
 */
import { fnv1a } from '../hash';
import { createRng } from '../rng';
import type { BandId } from '../types';
import { boardFor } from './board';
import { DICE_KEYS } from './keys';
import { applyMove, isFinished, moveOptions, newLane, roll } from './rules';
import type { DiceNote, DiceOp, DiceResponse, DiceRoll, LaneState, MoveOption, MoveResult } from './types';

export interface DicePlayer {
  /** Profile id (never shown; the UI shows the avatar). */
  id: string;
  band: BandId;
  /** Band B operators (see `diceOpsFor`); ignored for A and C. */
  ops: readonly DiceOp[];
}

export interface PendingTurn {
  roll: DiceRoll;
  options: MoveOption[];
}

export interface MatchState {
  seed: number;
  players: DicePlayer[];
  lanes: LaneState[];
  /** Index of the player whose turn it is. */
  turn: number;
  /** 1-based round number. */
  round: number;
  /** Rolls made so far; derives each roll's RNG. */
  rolls: number;
  pending: PendingTurn | null;
  over: boolean;
}

export function createMatch(players: readonly DicePlayer[], seed: number): MatchState {
  if (players.length < 1) throw new Error('a match needs players');
  return {
    seed,
    players: players.map((p) => ({ ...p, ops: [...p.ops] })),
    lanes: players.map((p) => newLane(boardFor(p.band, seed, p.ops))),
    turn: 0,
    round: 1,
    rolls: 0,
    pending: null,
    over: false,
  };
}

/** Roll for the current player (idempotent while a roll is pending). */
export function rollDice(match: MatchState): MatchState {
  if (match.over || match.pending) return match;
  const player = match.players[match.turn]!;
  const lane = match.lanes[match.turn]!;
  const r = roll(createRng(fnv1a(`dice.roll|${match.seed}|${match.rolls}`)), player.band);
  return {
    ...match,
    rolls: match.rolls + 1,
    pending: { roll: r, options: moveOptions(lane.board, lane.position, r, player.ops) },
  };
}

/**
 * Play the pending roll with option `choice` (always 0 for A and C). The
 * response never changes the move; see `applyMove`.
 */
export function playMove(match: MatchState, choice: number, response?: DiceResponse): { match: MatchState; result: MoveResult } {
  if (!match.pending) throw new Error('roll first');
  const option = match.pending.options[choice];
  if (!option) throw new Error(`no option ${choice}`);
  const result = applyMove(match.lanes[match.turn]!, option, response);
  const lanes = match.lanes.map((l, i) => (i === match.turn ? result.lane : l));
  const next = (match.turn + 1) % match.players.length;
  const roundOver = next === 0;
  const over = roundOver && lanes.some(isFinished);
  return {
    match: { ...match, lanes, turn: over ? match.turn : next, round: roundOver && !over ? match.round + 1 : match.round, pending: null, over },
    result,
  };
}

export interface PlayerSummary {
  id: string;
  arrived: boolean;
  line: DiceNote;
}

/** One celebratory line per player, in turn order. Nothing ranks anyone. */
export function matchSummary(match: MatchState): PlayerSummary[] {
  return match.players.map((p, i) => {
    const lane = match.lanes[i]!;
    const arrived = isFinished(lane);
    const line: DiceNote = arrived
      ? { key: DICE_KEYS.resultPond, params: { turns: lane.turns } }
      : { key: DICE_KEYS.resultJourney, params: { squares: lane.position - lane.board.start, turns: lane.turns } };
    return { id: p.id, arrived, line };
  });
}
