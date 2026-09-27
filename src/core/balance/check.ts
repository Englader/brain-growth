/**
 * Balance grading: misconceptions from a wrong value, the move-transcript
 * checker, and the item score.
 *
 * Transcript (`repr`) grammar, locale-free, `;`-separated:
 *
 *   repr   := (entry ';')* '=' value
 *   entry  := ['!'] token | 'u'      token as written by `moveToken`; 'u' = undo
 *   value  := ['-'] digits ['/' digits] | '?'
 *
 * Every move the child TRIED is listed in order; a move the UI refused is
 * prefixed with `!`, and `u` undoes the last applied move. `=?` means the
 * child asked to be shown the answer. Example for 2x + 4 = 10:
 * "L:-4;!/4;-4;/2;=3" (a one-pan move and a split into 4 were refused).
 *
 * The checker never trusts the UI: it replays every attempt from the item's
 * equation with `applyMove` and rejects the transcript as `forged` when an
 * attempt's `!` mark disagrees with the replay (an illegal move claimed as
 * made, or a legal one claimed as refused). The blocked count used for
 * scoring is the replay's, not the UI's.
 */
import { key, rat, type Rational } from '../rational';
import type { SolutionStep } from '../items/types';
import {
  coefs,
  eqn,
  isIntegerEquation,
  isolatedValue,
  needsBalloons,
  solveEquation,
  type Equation,
} from './equation';
import { BALANCE_SOL_KEYS, describeMove, type BalanceMisconception } from './keys';
import {
  applyMove,
  isBlocked,
  moveToken,
  parseMoveToken,
  solutionPath,
  startState,
  type BalanceMove,
  type BalanceState,
  type BlockReason,
} from './moves';

// ── Score ───────────────────────────────────────────────────────────────────

/** Item score: 1 − 0.25 per penalised blocked attempt (floor 0); 0 if the answer was revealed. */
export function balanceY(blockedAttempts: number, revealed: boolean): number {
  if (revealed) return 0;
  return Math.max(0, 1 - 0.25 * Math.max(0, blockedAttempts));
}

/** Only a move that would tip the scale costs score; the others are representational limits. */
export function isPenalised(reason: BlockReason): boolean {
  return reason === 'unbalanced';
}

// ── Misconceptions ──────────────────────────────────────────────────────────

/**
 * Values a child with a known bug would type for this equation, most specific
 * first; a value that two bugs predict is claimed by the earlier one, and a
 * value equal to the solution is dropped. Values may be non-integers.
 */
export function predictedErrors(eq: Equation): Array<{ value: Rational; code: BalanceMisconception }> {
  let [a, b, c, d] = coefs(eq);
  // Put the x-term on the left (for "5 = 2x + 1").
  if (a === 0) [a, b, c, d] = [c, d, a, b];
  const s = solveEquation(eq);
  if (!s) return [];
  const A = a - c;
  const K = d - b;
  const out: Array<{ value: Rational; code: BalanceMisconception }> = [];
  const add = (code: BalanceMisconception, n: number, den: number): void => {
    if (den === 0 || !Number.isFinite(n)) return;
    const v = rat(n, den);
    if (key(v) === key(s) || out.some((o) => key(o.value) === key(v))) return;
    out.push({ value: v, code });
  };
  add('balance.sign', -s.n, s.d);
  if (b !== 0) add('balance.keptSign', d + b, A);
  if (c !== 0) add('balance.keptSign', K, a + c);
  if (b !== 0) add('balance.oneSide', d, A);
  if (c !== 0) add('balance.oneSide', K, a);
  if (A !== 1) add('balance.noDivide', K, 1);
  if (A !== 1) add('balance.subCoef', K - A, 1);
  if (Math.abs(A) >= 2) add('balance.mulCoef', K * A, 1);
  if (A !== 1 && b !== 0 && c === 0) add('balance.divPartial', d - b * a, a);
  return out;
}

/** The misconception a wrong typed value signals, if any. */
export function detectMisconception(eq: Equation, typed: Rational): BalanceMisconception | null {
  const k = key(typed);
  return predictedErrors(eq).find((p) => key(p.value) === k)?.code ?? null;
}

/** Integer predictions in the `GeneratedItem.misconceptions` shape. */
export function balanceMisconceptions(eq: Equation): Array<{ value: number; code: string }> {
  return predictedErrors(eq)
    .filter((p) => p.value.d === 1)
    .map((p) => ({ value: p.value.n, code: p.code }));
}

// ── Item data ───────────────────────────────────────────────────────────────

/**
 * Item payload, all numbers so it fits both `prompt.data` and
 * `answer.check.params`: the equation `a·x + b = c·x + d`, `bal` (1 = the
 * scale shows balloons) and `iso` (1 = x must be isolated on the scale before
 * the typed value counts; 0 = the value may be typed at any time).
 */
export type BalanceData = {
  a: number;
  b: number;
  c: number;
  d: number;
  bal: 0 | 1;
  iso: 0 | 1;
};

export function balanceData(eq: Equation, balloons: boolean, requireIsolated = true): BalanceData {
  const [a, b, c, d] = coefs(eq);
  return { a, b, c, d, bal: balloons ? 1 : 0, iso: requireIsolated ? 1 : 0 };
}

const flag = (v: unknown, dflt: 0 | 1): 0 | 1 | null => (v === undefined ? dflt : v === 0 || v === 1 ? v : null);

/** Validates untrusted item data (e.g. from a stored log); `null` if malformed or not uniquely solvable in integers. */
export function readBalanceData(data: unknown): { eq: Equation; balloons: boolean; requireIsolated: boolean } | null {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;
  const nums = [o.a, o.b, o.c, o.d];
  if (!nums.every((v) => typeof v === 'number' && Number.isSafeInteger(v))) return null;
  const eq = eqn(...(nums as [number, number, number, number]));
  const s = solveEquation(eq);
  if (!isIntegerEquation(eq) || !s || s.d !== 1) return null;
  const bal = flag(o.bal, needsBalloons(eq) ? 1 : 0);
  const iso = flag(o.iso, 1);
  if (bal === null || iso === null) return null;
  if (bal === 0 && needsBalloons(eq)) return null;
  return { eq, balloons: bal === 1, requireIsolated: iso === 1 };
}

/** Worked solution: one `sol.balance.*` step per move of the shortest path, then the result. */
export function balanceSolutionSteps(eq: Equation, balloons: boolean): SolutionStep[] {
  const path = solutionPath(eq, balloons) ?? [];
  const s = solveEquation(eq);
  const steps: SolutionStep[] = path.map((m) => {
    const { key: k, params } = describeMove(m, true);
    return { k: 'say', key: k, params };
  });
  if (s) steps.push({ k: 'say', key: BALANCE_SOL_KEYS.result, params: { x: s.n } });
  return steps;
}

// ── Transcript ──────────────────────────────────────────────────────────────

export type TranscriptEntry =
  /** A move the child tried; `claimedBlocked` = the UI says it refused it (`!`). */
  | { kind: 'move'; move: BalanceMove; claimedBlocked: boolean }
  /** Undo the last applied move (`u`). */
  | { kind: 'undo' };

export interface Transcript {
  entries: TranscriptEntry[];
  /** The typed value of x; null when the child asked to be shown (`=?`). */
  value: Rational | null;
}

/** Longest transcript accepted (entries), and longest repr. */
export const MAX_ATTEMPTS = 200;
const MAX_REPR = 4000;

const VALUE_RE = /^=(?:(-?\d{1,6})(?:\/(\d{1,6}))?|(\?))$/;

export function parseTranscript(repr: string): Transcript | null {
  if (typeof repr !== 'string' || repr.length > MAX_REPR) return null;
  const parts = repr.split(';');
  if (parts.length - 1 > MAX_ATTEMPTS) return null;
  const last = VALUE_RE.exec(parts[parts.length - 1] ?? '');
  if (!last) return null;
  let value: Rational | null = null;
  if (last[3] === undefined) {
    const den = last[2] === undefined ? 1 : Number(last[2]);
    if (den === 0) return null;
    value = rat(Number(last[1]), den);
  }
  const entries: TranscriptEntry[] = [];
  for (const raw of parts.slice(0, -1)) {
    if (raw === 'u') {
      entries.push({ kind: 'undo' });
      continue;
    }
    const claimedBlocked = raw.startsWith('!');
    const move = parseMoveToken(claimedBlocked ? raw.slice(1) : raw);
    if (!move) return null;
    entries.push({ kind: 'move', move, claimedBlocked });
  }
  return { entries, value };
}

/** Writes a transcript in the canonical form `parseTranscript` reads. */
export function transcriptRepr(t: Transcript): string {
  const body = t.entries.map((e) => (e.kind === 'undo' ? 'u' : (e.claimedBlocked ? '!' : '') + moveToken(e.move)));
  return [...body, `=${t.value === null ? '?' : key(t.value)}`].join(';');
}

// ── Checker ─────────────────────────────────────────────────────────────────

export type BalanceCheckReason = 'parse' | 'forged' | 'revealed' | 'notIsolated' | 'wrongValue';

export interface BalanceCheckResult {
  ok: boolean;
  /**
   * Why not: `parse` (malformed data or repr: ask again), `forged` (a `!`
   * mark disagrees with the replay, or an undo with nothing to undo),
   * `revealed` (the child asked to be shown: a wrong attempt, credit 0),
   * `notIsolated` (x was not alone on the scale and the item requires it),
   * `wrongValue`.
   */
  reason?: BalanceCheckReason;
  /** The typed value (null on `parse` and `revealed`). */
  value: Rational | null;
  solution: Rational | null;
  /** Canonical transcript (the log's `given`); the raw repr on `parse`. */
  given: string;
  /** The replayed scale ends with x alone. */
  isolated: boolean;
  /** Moves the replay applied (undone ones included). */
  moves: number;
  /** Undos in the transcript. */
  undos: number;
  /** Refused attempts by reason, from the replay. */
  blocked: Record<BlockReason, number>;
  /** Refused attempts that cost score (`unbalanced`); feed to `balanceY`. */
  penalised: number;
  /** Isolated with no undo, in exactly as many moves as the shortest path. */
  optimal: boolean;
  misconception: BalanceMisconception | null;
}

const noBlocks = (): Record<BlockReason, number> => ({ unbalanced: 0, nonInteger: 0, noop: 0, negative: 0, invalid: 0 });

/**
 * Re-validates a Balance answer from the item data and the transcript alone.
 * Correct when the transcript parses, every `!` mark and undo matches the
 * replay, x is isolated at the end (unless the item has `iso: 0`), and the
 * typed value is the solution.
 */
export function checkBalance(data: unknown, repr: string): BalanceCheckResult {
  const item = readBalanceData(data);
  const t = item ? parseTranscript(repr) : null;
  if (!item || !t) {
    return {
      ok: false,
      reason: 'parse',
      value: null,
      solution: item ? solveEquation(item.eq) : null,
      given: typeof repr === 'string' ? repr.slice(0, 200) : '',
      isolated: false,
      moves: 0,
      undos: 0,
      blocked: noBlocks(),
      penalised: 0,
      optimal: false,
      misconception: null,
    };
  }
  const solution = solveEquation(item.eq)!;
  const blocked = noBlocks();
  const stack: BalanceState[] = [startState(item.eq, item.balloons)];
  let moves = 0;
  let undos = 0;
  let forged = false;
  for (const e of t.entries) {
    if (e.kind === 'undo') {
      undos++;
      if (stack.length > 1) stack.pop();
      else forged = true;
      continue;
    }
    const r = applyMove(stack[stack.length - 1]!, e.move);
    if (isBlocked(r)) {
      blocked[r.blocked]++;
      if (!e.claimedBlocked) forged = true;
    } else {
      if (e.claimedBlocked) forged = true;
      stack.push(r);
      moves++;
    }
  }
  const isolated = isolatedValue(stack[stack.length - 1]!.eq) !== null;
  const shortest = solutionPath(item.eq, item.balloons);
  const base = {
    value: t.value,
    solution,
    given: transcriptRepr(t),
    isolated,
    moves,
    undos,
    blocked,
    penalised: blocked.unbalanced,
    optimal: isolated && undos === 0 && shortest !== null && moves === shortest.length,
  };
  if (forged) return { ...base, ok: false, reason: 'forged', misconception: null };
  if (t.value === null) return { ...base, ok: false, reason: 'revealed', misconception: null };
  if (item.requireIsolated && !isolated) return { ...base, ok: false, reason: 'notIsolated', misconception: null };
  if (key(t.value) !== key(solution)) {
    return { ...base, ok: false, reason: 'wrongValue', misconception: detectMisconception(item.eq, t.value) };
  }
  return { ...base, ok: true, misconception: null };
}
