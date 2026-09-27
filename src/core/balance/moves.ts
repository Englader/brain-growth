/**
 * Moves on the Balance scale, and the shortest way to isolate x.
 *
 * A move adds or takes away the same constant or x-term on both pans, or
 * splits both pans into `n` equal groups (divides by `n`). A move the UI lets
 * the child aim at one pan only (dragging a weight off the left pan, say) has
 * `side: 'left' | 'right'`; it would unbalance the scale, so it is blocked.
 *
 * `applyMove` never throws on child input: an impossible move comes back as
 * `{ blocked: reason }` and leaves the scale as it was. The UI shows the
 * block and logs it; `balanceY` (./check.ts) charges only `unbalanced`.
 */
import { coefs, eqn, isolatedValue, type Equation } from './equation';

export type MoveSide = 'both' | 'left' | 'right';

export type BalanceMove =
  /** Add (`add`) or take away (`sub`) `n` unit weights, or `n` x-boxes when `term` is 'x'. */
  | { op: 'add' | 'sub'; term: 'x' | 'k'; n: number; side?: MoveSide }
  /** Split into `n` equal groups and keep one (divide by `n`; negative `n` also flips signs). */
  | { op: 'div'; n: number; side?: MoveSide };

/**
 * Why a move was refused:
 * - `unbalanced`: aimed at one pan only (the only reason `balanceY` charges);
 * - `nonInteger`: a division that would split a weight or an x-box;
 * - `noop`: changes nothing (adding 0, dividing by 1);
 * - `negative`: would need balloons on a scale that has none (Band B);
 * - `invalid`: not a move at all (dividing by 0, non-integer or huge `n`).
 */
export type BlockReason = 'unbalanced' | 'nonInteger' | 'noop' | 'negative' | 'invalid';

export interface BalanceState {
  readonly eq: Equation;
  /** Negative amounts may show as balloons (always in Band C; see `needsBalloons`). */
  readonly balloons: boolean;
}

export type Blocked = { readonly blocked: BlockReason };
export type MoveResult = BalanceState | Blocked;

/** Largest |n| a move may use, and largest |number| the scale may reach. */
export const MAX_MOVE_N = 1000;
export const MAX_SCALE_ABS = 10_000;

export function startState(eq: Equation, balloons: boolean): BalanceState {
  return { eq, balloons };
}

export function isBlocked(r: MoveResult): r is Blocked {
  return 'blocked' in r;
}

export function isIsolated(state: BalanceState): boolean {
  return isolatedValue(state.eq) !== null;
}

/** Signed change a move makes to [x-coefficient, constant] of each pan (add/sub only). */
function delta(m: Extract<BalanceMove, { op: 'add' | 'sub' }>): { dx: number; dk: number } {
  const v = m.op === 'add' ? m.n : -m.n;
  return m.term === 'x' ? { dx: v, dk: 0 } : { dx: 0, dk: v };
}

export function applyMove(state: BalanceState, move: BalanceMove): MoveResult {
  const n = move.n;
  if (!Number.isSafeInteger(n) || Math.abs(n) > MAX_MOVE_N) return { blocked: 'invalid' };
  if (move.op === 'div' && n === 0) return { blocked: 'invalid' };
  if ((move.op !== 'div' && n === 0) || (move.op === 'div' && n === 1)) return { blocked: 'noop' };
  if ((move.side ?? 'both') !== 'both') return { blocked: 'unbalanced' };

  const [a, b, c, d] = coefs(state.eq);
  let next: Equation;
  if (move.op === 'div') {
    if (a % n !== 0 || b % n !== 0 || c % n !== 0 || d % n !== 0) return { blocked: 'nonInteger' };
    next = eqn(a / n, b / n, c / n, d / n);
  } else {
    const { dx, dk } = delta(move);
    next = eqn(a + dx, b + dk, c + dx, d + dk);
  }
  const vals = coefs(next);
  if (vals.some((v) => Math.abs(v) > MAX_SCALE_ABS)) return { blocked: 'invalid' };
  if (!state.balloons && vals.some((v) => v < 0)) return { blocked: 'negative' };
  return { eq: next, balloons: state.balloons };
}

// ── Transcript tokens ───────────────────────────────────────────────────────

/**
 * Locale-free token for a move, as written in a transcript: "+3", "-4",
 * "+2x", "-x", "/3", "/-1", with "L:" or "R:" in front of a one-pan move.
 * A `sub` of a negative amount is written as the equivalent `add`.
 */
export function moveToken(m: BalanceMove): string {
  const side = m.side === 'left' ? 'L:' : m.side === 'right' ? 'R:' : '';
  if (m.op === 'div') return `${side}/${m.n}`;
  const signed = m.op === 'add' ? m.n : -m.n;
  const sign = signed < 0 ? '-' : '+';
  const mag = Math.abs(signed);
  return `${side}${sign}${m.term === 'x' ? (mag === 1 ? '' : String(mag)) + 'x' : String(mag)}`;
}

const TOKEN_RE = /^(?:([LR]):)?(?:([+-])(\d{1,4})?(x)?|\/(-?\d{1,4}))$/;

/** Parses one token written by `moveToken`; `null` if malformed. */
export function parseMoveToken(tok: string): BalanceMove | null {
  const m = TOKEN_RE.exec(tok);
  if (!m) return null;
  const side: MoveSide = m[1] === 'L' ? 'left' : m[1] === 'R' ? 'right' : 'both';
  if (m[5] !== undefined) return { op: 'div', n: Number(m[5]) + 0, side };
  const isX = m[4] === 'x';
  if (m[3] === undefined && !isX) return null; // a bare sign
  const n = m[3] === undefined ? 1 : Number(m[3]);
  return { op: m[2] === '+' ? 'add' : 'sub', term: isX ? 'x' : 'k', n, side };
}

// ── Shortest path ───────────────────────────────────────────────────────────

/** The kind of a move, as hint tier 1 names it. */
export type MoveKind = 'x' | 'k' | 'div';

export function moveKind(m: BalanceMove): MoveKind {
  return m.op === 'div' ? 'div' : m.term;
}

/** A both-pans move that removes `v` (signed) of `term`: sub for v > 0, add for v < 0. */
function removeMove(term: 'x' | 'k', v: number): BalanceMove {
  return v > 0 ? { op: 'sub', term, n: v } : { op: 'add', term, n: -v };
}

/**
 * Useful moves from `eq`, most natural first: gather the x-boxes on one pan
 * (removing the smaller amount first so the rest stays positive), clear the
 * weights next to the x-boxes, then split into equal groups.
 */
function candidates(eq: Equation): BalanceMove[] {
  const out: BalanceMove[] = [];
  const { l, r } = eq;
  if (l.x !== 0 && r.x !== 0) {
    const removeRight = removeMove('x', r.x); // leaves (l.x − r.x) on the left
    const removeLeft = removeMove('x', l.x); // leaves (r.x − l.x) on the right
    if (l.x - r.x > 0) out.push(removeRight, removeLeft);
    else out.push(removeLeft, removeRight);
  }
  for (const p of [l, r]) if (p.x !== 0 && p.k !== 0) out.push(removeMove('k', p.k));
  const xPan = l.x !== 0 && r.x === 0 ? l : r.x !== 0 && l.x === 0 ? r : null;
  if (xPan && xPan.k === 0 && xPan.x !== 1) out.push({ op: 'div', n: xPan.x });
  return out;
}

const stateKey = (eq: Equation): string => coefs(eq).join(',');

/**
 * The shortest sequence of balanced moves that isolates x (breadth-first, so
 * among equally short paths the one the `candidates` order prefers wins).
 * With `balloons: false` the path never needs a negative amount; for an
 * equation with positive numbers and a positive solution such a path always
 * exists. Returns `[]` when x is already isolated and `null` when no path of
 * at most `maxDepth` moves exists (no unique solution, or no balloons for a
 * negative solution).
 */
export function solutionPath(eq: Equation, balloons = true, maxDepth = 6): BalanceMove[] | null {
  const start = startState(eq, balloons);
  if (isIsolated(start)) return [];
  const seen = new Set<string>([stateKey(eq)]);
  let frontier: Array<{ state: BalanceState; path: BalanceMove[] }> = [{ state: start, path: [] }];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: typeof frontier = [];
    for (const { state, path } of frontier) {
      for (const m of candidates(state.eq)) {
        const r = applyMove(state, m);
        if (isBlocked(r)) continue;
        const k = stateKey(r.eq);
        if (seen.has(k)) continue;
        seen.add(k);
        const p = [...path, m];
        if (isIsolated(r)) return p;
        next.push({ state: r, path: p });
      }
    }
    frontier = next;
  }
  return null;
}

/** Applies moves in order; `null` if any is blocked. */
export function replayPath(state: BalanceState, moves: readonly BalanceMove[]): BalanceState | null {
  let s = state;
  for (const m of moves) {
    const r = applyMove(s, m);
    if (isBlocked(r)) return null;
    s = r;
  }
  return s;
}
