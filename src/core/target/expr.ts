/**
 * Expression trees for the Target ("Make it") mode.
 *
 * A child combines dealt cards two at a time; every merge is a binary node, so
 * the thing being built is a tree whose leaves are card values and whose
 * internal nodes are + − × ÷. Values are exact rationals throughout: 6 ÷ ¼ is
 * exactly 24, never 23.999….
 *
 * Four views of one tree live here:
 * - evaluation (`evaluate`), which is `null` for division by zero or overflow;
 * - a canonical form (`canonical`) that makes a+b and b+a, (a+b)+c and
 *   a+(b+c), a−(b−c) and a+c−b, a·(b÷c) and a·b÷c the same, so solution lists
 *   hold distinct ideas rather than rearrangements;
 * - `toRepr`/`parseRepr`: a stable, language-neutral ASCII string such as
 *   `(6/(1-(3/4)))`, used in logs, item data and the checker;
 * - `displayTokens`: tokens with the minimal brackets precedence needs. The
 *   i18n layer maps operators to locale glyphs (MK `·` and `:`).
 */
import type { Op } from '../items/types';
import { isInteger, key, rat, type Rational } from '../rational';

export type TargetOp = Op;
export const TARGET_OPS: readonly TargetOp[] = ['+', '-', '*', '/'];

export type TExpr =
  /** A card (or, in data from another source, any rational literal). */
  | { readonly k: 'n'; readonly v: Rational }
  | { readonly k: 'op'; readonly op: TargetOp; readonly a: TExpr; readonly b: TExpr };

/** Accepts an integer or a Rational and returns a normalised Rational. */
export function toRat(x: number | Rational): Rational {
  return typeof x === 'number' ? rat(x) : rat(x.n, x.d);
}

export const leaf = (v: number | Rational): TExpr => ({ k: 'n', v: toRat(v) });

export function node(op: TargetOp, a: TExpr | number, b: TExpr | number): TExpr {
  return { k: 'op', op, a: typeof a === 'number' ? leaf(a) : a, b: typeof b === 'number' ? leaf(b) : b };
}

// ── Exact, overflow-guarded arithmetic ─────────────────────────────────────

const safe = (x: number): boolean => Number.isSafeInteger(x);

/**
 * a op b, or `null` for division by zero or when any intermediate product
 * would leave the exactly representable integers (garbage input only: dealt
 * cards stay far below that).
 */
export function applyOp(op: TargetOp, a: Rational, b: Rational): Rational | null {
  switch (op) {
    case '+':
    case '-': {
      const x = a.n * b.d;
      const y = b.n * a.d;
      const d = a.d * b.d;
      const n = op === '+' ? x + y : x - y;
      return safe(x) && safe(y) && safe(d) && safe(n) ? rat(n, d) : null;
    }
    case '*': {
      const n = a.n * b.n;
      const d = a.d * b.d;
      return safe(n) && safe(d) ? rat(n, d) : null;
    }
    case '/': {
      if (b.n === 0) return null;
      const n = a.n * b.d;
      const d = a.d * b.n;
      return safe(n) && safe(d) ? rat(n, d) : null;
    }
  }
}

/** Exact value of a tree, or `null` if some step divides by zero or overflows. */
export function evaluate(e: TExpr): Rational | null {
  if (e.k === 'n') return e.v;
  const a = evaluate(e.a);
  if (!a) return null;
  const b = evaluate(e.b);
  if (!b) return null;
  return applyOp(e.op, a, b);
}

/** Card values in left-to-right order. */
export function leaves(e: TExpr): Rational[] {
  const out: Rational[] = [];
  const walk = (x: TExpr): void => {
    if (x.k === 'n') out.push(x.v);
    else {
      walk(x.a);
      walk(x.b);
    }
  };
  walk(e);
  return out;
}

/** Operators in the tree, in post-order (the order a child performs them). */
export function opsUsed(e: TExpr): TargetOp[] {
  if (e.k === 'n') return [];
  return [...opsUsed(e.a), ...opsUsed(e.b), e.op];
}

export function opCount(e: TExpr): number {
  return e.k === 'n' ? 0 : 1 + opCount(e.a) + opCount(e.b);
}

// ── Canonical form ─────────────────────────────────────────────────────────

/**
 * A sum is a multiset of added and subtracted terms, a product a multiset of
 * multiplied and divided factors; nested sums (products) flatten into their
 * parent, and each multiset is sorted. Two trees with equal keys are the same
 * solution rearranged by commutativity, associativity, or the rules
 * a−(b−c) = a−b+c and a÷(b÷c) = a·c÷b.
 *
 * Two identities are folded in too, because a child sees them as the same
 * move: subtracting a zero-valued term equals adding it, and dividing by a
 * one-valued factor equals multiplying by it (x·1 ≡ x÷1).
 *
 * The form is compositional: the key of a node depends only on its operator
 * and its children's keys. The solver relies on that to dedupe per subset.
 */
export interface Canon {
  readonly key: string;
  readonly v: Rational;
  /** 'n' leaf, 's' sum (pos − neg), 'p' product (pos ÷ neg). */
  readonly kind: 'n' | 's' | 'p';
  readonly pos: readonly Canon[];
  readonly neg: readonly Canon[];
}

const NO_TERMS: readonly Canon[] = [];

export function canonLeaf(v: Rational): Canon {
  return { key: key(v), v, kind: 'n', pos: NO_TERMS, neg: NO_TERMS };
}

const byKey = (x: Canon, y: Canon): number => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);

/** Canonical form of `a op b`, given the (already known) value `v` of that node. */
export function canonCombine(op: TargetOp, a: Canon, b: Canon, v: Rational): Canon {
  const additive = op === '+' || op === '-';
  const kind = additive ? 's' : 'p';
  const aPos = a.kind === kind ? a.pos : [a];
  const aNeg = a.kind === kind ? a.neg : NO_TERMS;
  const bPos = b.kind === kind ? b.pos : [b];
  const bNeg = b.kind === kind ? b.neg : NO_TERMS;
  const direct = op === '+' || op === '*';
  const pos = [...aPos, ...(direct ? bPos : bNeg)];
  const neg: Canon[] = [];
  // x − 0 ≡ x + 0 and x ÷ 1 ≡ x · 1.
  const neutral = additive ? 0 : 1;
  for (const t of [...aNeg, ...(direct ? bNeg : bPos)]) {
    if (t.v.d === 1 && t.v.n === neutral) pos.push(t);
    else neg.push(t);
  }
  pos.sort(byKey);
  neg.sort(byKey);
  const k = `${kind === 's' ? 'S' : 'P'}(${pos.map((t) => t.key).join(',')};${neg.map((t) => t.key).join(',')})`;
  return { key: k, v, kind, pos, neg };
}

/** Canonical form of a tree, or `null` if the tree cannot be evaluated. */
export function canonical(e: TExpr): Canon | null {
  if (e.k === 'n') return canonLeaf(e.v);
  const a = canonical(e.a);
  if (!a) return null;
  const b = canonical(e.b);
  if (!b) return null;
  const v = applyOp(e.op, a.v, b.v);
  return v ? canonCombine(e.op, a, b, v) : null;
}

/** Dedupe key: equal for rearrangements of the same solution. */
export function canonicalKey(e: TExpr): string | null {
  return canonical(e)?.key ?? null;
}

// ── Language-neutral string form ───────────────────────────────────────────

/** Literal for one value: `6`, `-3`, and `[3/4]` for a non-integer. */
export function literal(v: Rational): string {
  return isInteger(v) ? String(v.n) : `[${v.n}/${v.d}]`;
}

/**
 * Stable ASCII form with every operation bracketed, e.g. `(6/(1-(3/4)))`.
 * `parseRepr(toRepr(e))` returns the identical tree.
 */
export function toRepr(e: TExpr): string {
  return e.k === 'n' ? literal(e.v) : `(${toRepr(e.a)}${e.op}${toRepr(e.b)})`;
}

/** Longest input `parseRepr` reads; four to six cards need far less. */
export const MAX_REPR_LENGTH = 400;
const MAX_DEPTH = 40;
const MAX_DIGITS = 9;

class ParseError extends Error {}

/**
 * Parses ASCII infix with the usual precedence and left associativity:
 * `+ - * /`, brackets, integer literals (a leading `-` directly before a digit
 * in operand position is a negative literal), and `[n/d]` fraction literals.
 * Whitespace is ignored. Everything else (Unicode operators, unary minus on a
 * bracket, empty brackets, trailing input) is rejected with `null`.
 *
 * On `toRepr` output, which brackets every node, the tree comes back exactly.
 */
export function parseRepr(input: unknown): TExpr | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_REPR_LENGTH) return null;
  const s = input;
  let i = 0;
  let depth = 0;

  const skip = (): void => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) i++;
  };
  const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
  const integer = (): number => {
    const neg = s[i] === '-';
    if (neg) i++;
    const start = i;
    while (isDigit(s[i])) i++;
    const len = i - start;
    if (len === 0 || len > MAX_DIGITS) throw new ParseError();
    const n = Number(s.slice(start, i));
    return neg ? -n : n;
  };

  const atom = (): TExpr => {
    skip();
    const c = s[i];
    if (c === '(') {
      if (++depth > MAX_DEPTH) throw new ParseError();
      i++;
      const e = sum();
      skip();
      if (s[i] !== ')') throw new ParseError();
      i++;
      depth--;
      return e;
    }
    if (c === '[') {
      i++;
      skip();
      const n = integer();
      skip();
      if (s[i] !== '/') throw new ParseError();
      i++;
      skip();
      const d = integer();
      skip();
      if (s[i] !== ']' || d <= 0) throw new ParseError();
      i++;
      return leaf(rat(n, d));
    }
    if (isDigit(c) || (c === '-' && isDigit(s[i + 1]))) return leaf(integer());
    throw new ParseError();
  };

  const product = (): TExpr => {
    let left = atom();
    for (;;) {
      skip();
      const c = s[i];
      if (c !== '*' && c !== '/') return left;
      i++;
      left = node(c, left, atom());
    }
  };

  const sum = (): TExpr => {
    let left = product();
    for (;;) {
      skip();
      const c = s[i];
      if (c !== '+' && c !== '-') return left;
      i++;
      left = node(c, left, product());
    }
  };

  try {
    const e = sum();
    skip();
    return i === s.length ? e : null;
  } catch (err) {
    if (err instanceof ParseError) return null;
    throw err;
  }
}

// ── Display tokens with minimal brackets ───────────────────────────────────

export type DisplayToken =
  | { t: 'num'; v: Rational }
  | { t: 'op'; op: TargetOp }
  | { t: 'paren'; s: '(' | ')' };

const PREC: Record<TargetOp, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

export function precedence(e: TExpr): number {
  return e.k === 'n' ? 3 : PREC[e.op];
}

/** Whether the child `side` of `parent` needs brackets when printed infix. */
export function needsBrackets(parent: TargetOp, child: TExpr, side: 'a' | 'b'): boolean {
  const pc = precedence(child);
  const pp = PREC[parent];
  if (pc < pp) return true;
  // a − (b ± c) and a ÷ (b ×÷ c): the right side of − and ÷ does not associate.
  return side === 'b' && pc === pp && (parent === '-' || parent === '/');
}

/**
 * Tokens for `e` with the fewest brackets that keep its value: `6 / (1 - 3 / 4)`,
 * `3 * 4 - 2`. A negative literal after an operator is bracketed: `6 - (-3)`.
 * Operators stay as ASCII ids; the i18n layer maps them to glyphs and renders
 * non-integer literals as stacked fractions.
 */
export function displayTokens(e: TExpr): DisplayToken[] {
  const out: DisplayToken[] = [];
  const emit = (x: TExpr): void => {
    if (x.k === 'n') {
      const prev = out[out.length - 1];
      if (x.v.n < 0 && prev?.t === 'op') out.push({ t: 'paren', s: '(' }, { t: 'num', v: x.v }, { t: 'paren', s: ')' });
      else out.push({ t: 'num', v: x.v });
      return;
    }
    const side = (child: TExpr, which: 'a' | 'b'): void => {
      if (needsBrackets(x.op, child, which)) {
        out.push({ t: 'paren', s: '(' });
        emit(child);
        out.push({ t: 'paren', s: ')' });
      } else emit(child);
    };
    side(x.a, 'a');
    out.push({ t: 'op', op: x.op });
    side(x.b, 'b');
  };
  emit(e);
  return out;
}

/** ASCII text of display tokens (tests, logs); `parseRepr` reads it back. */
export function tokensToAscii(tokens: readonly DisplayToken[]): string {
  return tokens
    .map((tk) => (tk.t === 'num' ? literal(tk.v) : tk.t === 'op' ? ` ${tk.op} ` : tk.s))
    .join('');
}
