/**
 * Every message key the Balance core hands to the UI, with its params. The
 * strings live in the locale bundles (en and mk, same order): the `balance`
 * top-level block, `sol.balance` and `mis.balance`. tests/balance.test.ts pins
 * that the core only emits keys listed here.
 */
import type { BalanceMove, BlockReason, MoveKind } from './moves';

export type MoveKeyId = 'addX' | 'subX' | 'addK' | 'subK' | 'div';

/**
 * A move in words, params `{n}` (n > 0 for add/sub; any non-zero integer for
 * div). Used by hint tiers 2 and 3 and by the move log beside the scale.
 * For x-terms n = 1 means "x": `{n, plural, =1 {x} other {#x}}`.
 */
export const BALANCE_MOVE_KEYS: Record<MoveKeyId, string> = {
  addX: 'balance.move.addX', // "Add {n}x to both pans."
  subX: 'balance.move.subX', // "Take {n}x off both pans."
  addK: 'balance.move.addK', // "Add {n} to both pans."
  subK: 'balance.move.subK', // "Take {n} off both pans."
  div: 'balance.move.div', // "Split both pans into {n} equal groups." (n may be −1: "Flip every sign.")
};

/** Hint tier 1 (and tier 3's `nextKind`, via `balance.hint.then.*`): the kind of move, no params. */
export const BALANCE_HINT_KEYS: Record<MoveKind, string> = {
  x: 'balance.hint.x', // "Get all the x-boxes onto one pan."
  k: 'balance.hint.k', // "Clear the weights from the pan with the x-boxes."
  div: 'balance.hint.div', // "Split both pans into equal groups."
};
export const BALANCE_HINT_THEN_KEYS: Record<MoveKind, string> = {
  x: 'balance.hint.then.x', // "Then gather the x-boxes."
  k: 'balance.hint.then.k', // "Then clear the weights next to x."
  div: 'balance.hint.then.div', // "Then split into equal groups."
};

/** Shown when a move is refused. No params. */
export const BALANCE_BLOCKED_KEYS: Record<BlockReason, string> = {
  unbalanced: 'balance.blocked.unbalanced', // "Do the same to both pans, or the scale tips."
  nonInteger: 'balance.blocked.nonInteger', // "That doesn't split into equal groups."
  noop: 'balance.blocked.noop', // "That doesn't change the scale."
  negative: 'balance.blocked.negative', // "There isn't that much on the pan."
  invalid: 'balance.blocked.invalid', // "That move isn't possible."
};

/** Worked solution after a wrong answer: one step per move `{n}`, then the result `{x}`. */
export const BALANCE_SOL_KEYS = {
  addX: 'sol.balance.addX',
  subX: 'sol.balance.subX',
  addK: 'sol.balance.addK',
  subK: 'sol.balance.subK',
  div: 'sol.balance.div',
  result: 'sol.balance.result', // {x}: "So x = {x}."
} as const;

/** Misconception codes; strings at `mis.<code>.{name,tip}` (the `mis.balance` sub-block). */
export const BALANCE_MISCONCEPTIONS = [
  'balance.sign', // typed −x (balloons read as weights, or a sign slip)
  'balance.keptSign', // moved a term across without changing its sign (added instead of taking away)
  'balance.oneSide', // took a term off one pan only
  'balance.noDivide', // stopped at a·x = d and typed d
  'balance.subCoef', // a·x = d: typed d − a (subtracted instead of splitting)
  'balance.mulCoef', // a·x = d: typed d·a (multiplied instead of splitting)
  'balance.divPartial', // a·x + b = d: split x and d but not b, typed d/a − b
] as const;
export type BalanceMisconception = (typeof BALANCE_MISCONCEPTIONS)[number];

/** Other `balance.*` UI strings the mode will need (listed here so the integrator has one list). */
export const BALANCE_UI_KEYS = [
  'balance.title',
  'balance.flag',
  'balance.prompt', // "Get x alone on one pan, then type x."
  'balance.typeX', // label of the x = ? field
  'balance.moveInput', // label of the move field
  'balance.undo',
  'balance.x', // aria label of one x-box
  'balance.xBalloon', // aria label of one x-balloon
  'balance.unit', // aria label of a unit weight
  'balance.balloon', // aria label of a unit balloon
] as const;

function signedN(m: Extract<BalanceMove, { op: 'add' | 'sub' }>): number {
  return m.op === 'add' ? m.n : -m.n;
}

/** Which key describes a move (a `sub` of a negative amount is the matching `add`). */
export function moveKeyId(m: BalanceMove): MoveKeyId {
  if (m.op === 'div') return 'div';
  const up = signedN(m) >= 0;
  if (m.term === 'x') return up ? 'addX' : 'subX';
  return up ? 'addK' : 'subK';
}

/** A move as `{key, params}` for `balance.move.*` (or `sol.balance.*` with `sol: true`). */
export function describeMove(m: BalanceMove, sol = false): { key: string; params: { n: number } } {
  const id = moveKeyId(m);
  const n = m.op === 'div' ? m.n : Math.abs(signedN(m));
  return { key: sol ? BALANCE_SOL_KEYS[id] : BALANCE_MOVE_KEYS[id], params: { n } };
}
