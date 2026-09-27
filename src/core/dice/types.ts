/**
 * Dice Race data shapes. Everything is plain, serialisable JSON so a match
 * can live in a local store and survive a reload. Nothing here is display
 * text: the UI turns the message keys in `keys.ts` into words.
 */
import type { BandId, SkillId } from '../types';

/** Operators a move can use. Subset of the item `Op` type ('*' is ×). */
export type DiceOp = '+' | '-' | '*';

/** The four integer add/sub forms of the `intAddSub` generator (b > 0 in the name). */
export type IntForm = 'a+b' | 'a-b' | 'a+(-b)' | 'a-(-b)';

export interface Ladder {
  /** Landing exactly here climbs the ladder… */
  foot: number;
  /** …to here. Always strictly between `foot` and the finish. */
  top: number;
}

export interface Board {
  band: BandId;
  /** Where the token starts. */
  start: number;
  /** Reaching this square finishes the race (moves stop here, never past it). */
  finish: number;
  /** Lowest square on the lane (Band C backward moves never go below it). */
  floor: number;
  /** Band B only; empty elsewhere. Sorted by foot. */
  ladders: readonly Ladder[];
  /** The seed the ladders were placed from (same seed + band + ops → same board). */
  seed: number;
}

export type DiceRoll =
  /** One die of dots. */
  | { band: 'A'; dots: number }
  /** Two dice, combined by the child with an operator. */
  | { band: 'B'; dice: readonly [number, number] }
  /** A number die (1–10) and a form die. */
  | { band: 'C'; n: number; form: IntForm };

/**
 * The operands of the item a move asks for. The integration turns this into
 * a real item through the generator bound to `skillHint` (a fixed item with
 * these operands). For Band C, `b` is SIGNED: `a − (−3)` is `{op:'-', b:-3}`.
 */
export interface DiceItemSpec {
  skillHint: SkillId;
  a: number;
  op: DiceOp;
  b: number;
  expected: number;
}

export interface MoveOption {
  op: DiceOp;
  /** Band C only: the form actually asked (after a floor bounce, the mirrored form). */
  form?: IntForm;
  item: DiceItemSpec;
  /** Square the move starts from. */
  from: number;
  /** Square the token lands on (before any ladder). */
  land: number;
  /** Final square after climbing a ladder (equals `land` when there is none). */
  target: number;
  ladder: Ladder | null;
  /** The move was shortened (A, C) or stopped (B) at the finish. */
  capped: boolean;
  /** Band C: a backward form that would have left the lane was mirrored forward. */
  bounced: boolean;
}

export interface LaneState {
  board: Board;
  position: number;
  /** Turns taken on this lane. */
  turns: number;
}

/**
 * What the child answered, if anything. Accepted so the contract is explicit:
 * it NEVER changes the move (no punishment for wrong answers, nothing depends
 * on latency). It only decides the `correct` flag reported back for feedback.
 */
export interface DiceResponse {
  given: number | null;
  latencyMs?: number;
}

/** A UI line: a message key plus numeric params. Never text. */
export interface DiceNote {
  key: string;
  params?: Record<string, number>;
}

export interface MoveResult {
  lane: LaneState;
  /** null when no response was given. Informational only. */
  correct: boolean | null;
  climbed: Ladder | null;
  finished: boolean;
  notes: DiceNote[];
}
