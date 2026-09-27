/**
 * Dice Race rules: rolls, the moves a roll allows, and applying a move.
 *
 * The computed move IS the maths:
 *   A  one die of dots → `position + dots` (always forward, counted on in hops)
 *   B  two dice → the child picks + − × (operators whose skill is unlocked);
 *      the fact `d1 op d2` is how far the token moves; landing on a ladder
 *      foot climbs it. − is the "smaller step" that can hit a ladder.
 *   C  number die (1–10) + form die → an integer add/sub from the position,
 *      e.g. `−3 − (−4)` moves forward to 1, `5 + (−4)` moves back to 1.
 *
 * Wrong answers are never punished: the token moves by the CORRECT amount
 * whatever the child answered, and nothing here reads answer latency.
 *
 * Lane ends: a move never passes the finish. In A and C the item is
 * shortened to the hops actually needed (so the item's answer IS the
 * finish); in B the fact is independent of position, so the token simply
 * stops at the finish. In C a backward form that would drop below the floor
 * is mirrored to its forward twin (`a − b` → `a + b`, `a + (−b)` → `a − (−b)`).
 */
import type { Rng } from '../rng';
import type { BandId, SkillId } from '../types';
import { ladderAt } from './board';
import { DICE_KEYS } from './keys';
import type {
  Board,
  DiceItemSpec,
  DiceNote,
  DiceOp,
  DiceResponse,
  DiceRoll,
  IntForm,
  LaneState,
  MoveOption,
  MoveResult,
} from './types';

export const DIE_FACES = 6;
/** Band C number die: 1…10, the same range as the `intAddSub` generator's b. */
export const NUMBER_DIE_FACES = 10;
/**
 * Band C form die (12 faces): 5/6 of rolls move forward, so the lane keeps the
 * pace of the other bands while every form still turns up.
 */
export const FORM_DIE: readonly IntForm[] = [
  'a+b', 'a-(-b)', 'a+b', 'a-(-b)', 'a+b', 'a-(-b)',
  'a+b', 'a-(-b)', 'a+b', 'a-(-b)', 'a-b', 'a+(-b)',
];

/** Operators in their fixed display (and tie-break) order. */
export const DICE_OPS: readonly DiceOp[] = ['+', '-', '*'];

/** The skill that must be unlocked before a Band B child is offered each operator. */
export const DICE_OP_SKILL: Readonly<Record<DiceOp, SkillId>> = {
  '+': 'as.add.20',
  '-': 'as.sub.10',
  '*': 'md.mult.facts',
};

/** Band B operators for a child, from which skills are unlocked. '+' is always offered. */
export function diceOpsFor(isUnlocked: (skill: SkillId) => boolean): DiceOp[] {
  return DICE_OPS.filter((op) => op === '+' || isUnlocked(DICE_OP_SKILL[op]));
}

export function roll(rng: Rng, band: BandId): DiceRoll {
  switch (band) {
    case 'A':
      return { band, dots: rng.int(1, DIE_FACES) };
    case 'B':
      return { band, dice: [rng.int(1, DIE_FACES), rng.int(1, DIE_FACES)] };
    case 'C':
      return { band, n: rng.int(1, NUMBER_DIE_FACES), form: rng.pick(FORM_DIE) };
  }
}

const isForward = (form: IntForm): boolean => form === 'a+b' || form === 'a-(-b)';

const MIRROR: Readonly<Record<IntForm, IntForm>> = {
  'a+b': 'a-b',
  'a-b': 'a+b',
  'a+(-b)': 'a-(-b)',
  'a-(-b)': 'a+(-b)',
};

/** Operands of an integer form, with b signed as written: `a − (−3)` → op '-', b −3. */
export function formSpec(form: IntForm, a: number, n: number): DiceItemSpec {
  const op: DiceOp = form === 'a+b' || form === 'a+(-b)' ? '+' : '-';
  const b = form.includes('(-b)') ? -n : n;
  return { skillHint: 'int.addsub', a, op, b, expected: op === '+' ? a + b : a - b };
}

/** The within-10 / within-20 addition skill a sum belongs to. */
const addSkill = (sum: number): SkillId => (sum <= 10 ? 'as.add.10' : 'as.add.20');

function optionA(board: Board, from: number, dots: number): MoveOption {
  const hops = Math.min(dots, board.finish - from);
  const land = from + hops;
  return {
    op: '+',
    item: { skillHint: addSkill(land), a: from, op: '+', b: hops, expected: land },
    from,
    land,
    target: land,
    ladder: null,
    capped: hops < dots,
    bounced: false,
  };
}

function factB(op: DiceOp, d1: number, d2: number): DiceItemSpec {
  switch (op) {
    case '+':
      return { skillHint: addSkill(d1 + d2), a: d1, op, b: d2, expected: d1 + d2 };
    case '-': {
      const a = Math.max(d1, d2);
      const b = Math.min(d1, d2);
      return { skillHint: 'as.sub.10', a, op, b, expected: a - b };
    }
    case '*': {
      const skill = [d1, d2].some((d) => d === 2 || d === 5) ? 'md.mult.2510' : 'md.mult.facts';
      return { skillHint: skill, a: d1, op, b: d2, expected: d1 * d2 };
    }
  }
}

function optionsB(board: Board, from: number, dice: readonly [number, number], ops: readonly DiceOp[]): MoveOption[] {
  const allowed = DICE_OPS.filter((op) => op === '+' || ops.includes(op));
  const out: MoveOption[] = [];
  for (const op of allowed) {
    const item = factB(op, dice[0], dice[1]);
    if (item.expected <= 0) continue; // a double never offers "move 0"
    const land = Math.min(board.finish, from + item.expected);
    const ladder = ladderAt(board, land);
    out.push({
      op,
      item,
      from,
      land,
      target: ladder ? ladder.top : land,
      ladder,
      capped: from + item.expected > board.finish,
      bounced: false,
    });
  }
  return out;
}

function optionC(board: Board, from: number, n: number, rolled: IntForm): MoveOption {
  let form = rolled;
  let bounced = false;
  if (!isForward(form) && from - n < board.floor) {
    form = MIRROR[form];
    bounced = true;
  }
  const hops = isForward(form) ? Math.min(n, board.finish - from) : n;
  const item = formSpec(form, from, hops);
  return {
    op: item.op,
    form,
    item,
    from,
    land: item.expected,
    target: item.expected,
    ladder: null,
    capped: hops < n,
    bounced,
  };
}

/**
 * Every move a roll allows from `position` (A and C: exactly one; B: one per
 * allowed operator, in + − × order). `unlockedOps` only matters for Band B.
 */
export function moveOptions(board: Board, position: number, dice: DiceRoll, unlockedOps: readonly DiceOp[] = []): MoveOption[] {
  if (dice.band !== board.band) throw new Error(`roll for band ${dice.band} on a band ${board.band} board`);
  if (position >= board.finish) return [];
  switch (dice.band) {
    case 'A':
      return [optionA(board, position, dice.dots)];
    case 'B':
      return optionsB(board, position, dice.dice, unlockedOps);
    case 'C':
      return [optionC(board, position, dice.n, dice.form)];
  }
}

export function newLane(board: Board): LaneState {
  return { board, position: board.start, turns: 0 };
}

export function isFinished(lane: LaneState): boolean {
  return lane.position >= lane.board.finish;
}

/**
 * Move the token. The response is optional and NEVER changes where the token
 * goes: a wrong, missing, hinted or slow answer moves exactly as far as a
 * right one. It only fills `correct` for the feedback screen.
 */
export function applyMove(lane: LaneState, option: MoveOption, response?: DiceResponse): MoveResult {
  if (option.from !== lane.position) throw new Error(`move from ${option.from} but the token is on ${lane.position}`);
  if (isFinished(lane)) throw new Error('this lane has already finished');
  const next: LaneState = { ...lane, position: option.target, turns: lane.turns + 1 };
  const notes: DiceNote[] = [];
  if (option.bounced) notes.push({ key: DICE_KEYS.bounce });
  if (option.capped) notes.push({ key: DICE_KEYS.capped, params: { hops: Math.abs(option.land - option.from) } });
  if (option.ladder) notes.push({ key: DICE_KEYS.ladder, params: { from: option.ladder.foot, to: option.ladder.top } });
  const finished = isFinished(next);
  if (finished) notes.push({ key: DICE_KEYS.arrived });
  const given = response?.given;
  return {
    lane: next,
    correct: given === undefined || given === null ? null : given === option.item.expected,
    climbed: option.ladder,
    finished,
    notes,
  };
}
