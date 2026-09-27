import { describe, expect, it } from 'vitest';
import { eq, isInteger, key, rat, toNumber, type Rational } from '../src/core/rational';
import { createRng } from '../src/core/rng';
import { getLocale } from '../src/i18n/locales';
import {
  applyOp,
  canonicalKey,
  displayTokens,
  evaluate,
  leaf,
  leaves,
  node,
  opsUsed,
  parseRepr,
  TARGET_OPS,
  toRepr,
  tokensToAscii,
  type TExpr,
  type TargetOp,
} from '../src/core/target/expr';
import {
  reachableValues,
  solve,
  solveDetailed,
  solveMakeTen,
  type SolveOptions,
  type Solution,
} from '../src/core/target/solver';
import { checkDealRepr, checkTargetRepr, readDealData } from '../src/core/target/check';
import { makeDeal, toDealData, type TargetBand, type TargetDeal } from '../src/core/target/deal';
import { solutionSteps, targetHint, targetHints } from '../src/core/target/hints';
import { glickoElo } from '../src/core/engine/glicko';
import { replay } from '../src/core/engine/replay';
import { SessionEngine } from '../src/core/engine/session';
import { GRAPH } from '../src/core/skills';
import '../src/modes';
import { getBand } from '../src/bands/registry';
import { ACHIEVEMENTS, evaluateAchievements, getMetric, validateAchievements, type EvalContext } from '../src/core/achievements';
import { modeEvidence } from '../src/core/engine/params';
import { isEnabled } from '../src/core/flags';
import { getGenerator } from '../src/core/items/generators';
import { targetData, targetLine } from '../src/core/items/generators/makeIt';
import { gradeResponse } from '../src/core/items/grade';
import type { Item } from '../src/core/items/types';
import { EVENTS, type LogRecord } from '../src/core/log/types';
import { createProfile, type Profile } from '../src/core/profile';
import { dayKey } from '../src/core/time';
import { customVoice, promptText } from '../src/i18n/render';
import { getMode } from '../src/modes/registry';
import { hasTargetWork } from '../src/modes/target';
import { exprText, valueText } from '../src/modes/target/format';

const ALL: SolveOptions = {
  ops: TARGET_OPS,
  allowFractionIntermediates: true,
  allowNegativeIntermediates: true,
  mustUseAll: true,
};

const ascii = (e: TExpr): string => tokensToAscii(displayTokens(e));
const mustParse = (s: string): TExpr => {
  const e = parseRepr(s);
  if (!e) throw new Error(`did not parse: ${s}`);
  return e;
};
const valueOf = (s: string): number => toNumber(evaluate(mustParse(s))!);

/** Every intermediate (non-leaf) value of a tree. */
function intermediates(e: TExpr): Rational[] {
  if (e.k === 'n') return [];
  const out = [...intermediates(e.a), ...intermediates(e.b)];
  out.push(evaluate(e)!);
  return out;
}

/** Asserts a solution is a genuine answer to the deal under the rules. */
function assertSolves(e: TExpr, cards: number[], target: number, o: SolveOptions, label: string): void {
  expect(evaluate(e), label).toEqual(rat(target));
  const pool = cards.map((c) => rat(c));
  for (const v of leaves(e)) {
    const i = pool.findIndex((c) => eq(c, v));
    expect(i, `${label}: leaf ${key(v)} is an unused card`).toBeGreaterThanOrEqual(0);
    pool.splice(i, 1);
  }
  if (o.mustUseAll) expect(pool, `${label}: all cards used`).toEqual([]);
  for (const op of opsUsed(e)) expect(o.ops ?? TARGET_OPS, label).toContain(op);
  for (const v of intermediates(e)) {
    if (!o.allowFractionIntermediates) expect(isInteger(v), `${label}: integer steps`).toBe(true);
    if (!o.allowNegativeIntermediates) expect(v.n, `${label}: non-negative steps`).toBeGreaterThanOrEqual(0);
  }
}

/**
 * Independent brute force: every tree over the cards (classic "pick two,
 * combine, recurse"), with the same pruning rules, reduced to canonical keys.
 */
function bruteCanon(cards: number[], target: number, o: SolveOptions): Set<string> {
  const out = new Set<string>();
  const t = rat(target);
  const okValue = (r: Rational | null): r is Rational =>
    r !== null && (!!o.allowFractionIntermediates || isInteger(r)) && (!!o.allowNegativeIntermediates || r.n >= 0);
  const rec = (items: Array<{ e: TExpr; v: Rational }>): void => {
    for (const it of items) {
      if ((!o.mustUseAll || items.length === 1) && eq(it.v, t)) out.add(canonicalKey(it.e)!);
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = 0; j < items.length; j++) {
        if (i === j) continue;
        const rest = items.filter((_, k) => k !== i && k !== j);
        for (const op of o.ops ?? TARGET_OPS) {
          const x = items[i]!;
          const y = items[j]!;
          const r = applyOp(op, x.v, y.v);
          if (okValue(r)) rec([...rest, { e: node(op, x.e, y.e), v: r }]);
        }
      }
    }
  };
  rec(cards.map((c) => ({ e: leaf(c), v: rat(c) })));
  return out;
}

describe('target expressions', () => {
  const classic = node('/', 6, node('-', 1, node('/', 3, 4)));

  it('prints a stable, fully bracketed ASCII repr and parses it back to the same tree', () => {
    expect(toRepr(classic)).toBe('(6/(1-(3/4)))');
    expect(parseRepr('(6/(1-(3/4)))')).toEqual(classic);
    expect(toRepr(leaf(7))).toBe('7');
    expect(toRepr(node('+', -3, leaf(rat(-3, 4))))).toBe('(-3+[-3/4])');
    expect(parseRepr('(-3+[-3/4])')).toEqual(node('+', -3, leaf(rat(-3, 4))));
  });

  it('round-trips random trees, including negative and fraction literals', () => {
    const rng = createRng(42);
    const randomTree = (depth: number): TExpr => {
      if (depth === 0 || rng.chance(0.3)) {
        const v = rng.chance(0.2) ? rat(rng.int(-9, 9), rng.int(2, 7)) : rat(rng.int(-13, 13));
        return leaf(v);
      }
      return node(rng.pick(TARGET_OPS), randomTree(depth - 1), randomTree(depth - 1));
    };
    for (let i = 0; i < 500; i++) {
      const e = randomTree(4);
      expect(parseRepr(toRepr(e))).toEqual(e);
      // Minimal-bracket display text parses to an equivalent tree.
      const back = mustParse(ascii(e));
      expect(evaluate(back)).toEqual(evaluate(e));
      if (evaluate(e)) expect(canonicalKey(back)).toBe(canonicalKey(e));
    }
  });

  it('parses infix with precedence and left associativity', () => {
    expect(parseRepr('6/(1-3/4)')).toEqual(classic);
    expect(parseRepr(' 6 / ( 1 - 3 / 4 ) ')).toEqual(classic);
    expect(valueOf('8-3-2')).toBe(3);
    expect(valueOf('2+3*4')).toBe(14);
    expect(valueOf('12/3/2')).toBe(2);
    expect(valueOf('6--3')).toBe(9);
    expect(valueOf('-3*4')).toBe(-12);
  });

  it('rejects garbage without throwing', () => {
    const bad: unknown[] = [
      '', ' ', '(', ')', '()', '6+', '+6', '*6', '6 - - 3', '-(3)', '--3', '6×4', '6÷2', '6·4', '6:2', '6−3',
      'abc', '1e3', '3.5', '3,5', '(6*4', '6*4)', '6 4', '[3/0]', '[3/-4]', '[3]', '[3/4', '1234567890',
      '('.repeat(60) + '1' + ')'.repeat(60), '1+'.repeat(300) + '1', null, undefined, 42, {}, ['6'],
    ];
    for (const s of bad) expect(parseRepr(s), JSON.stringify(s)).toBeNull();
    const rng = createRng(7);
    const alphabet = '0123456789+-*/()[] x';
    for (let i = 0; i < 2000; i++) {
      const s = Array.from({ length: rng.int(1, 14) }, () => alphabet[rng.int(0, alphabet.length - 1)]).join('');
      const e = parseRepr(s);
      if (e) expect(parseRepr(toRepr(e))).toEqual(e);
    }
  });

  it('evaluates exactly; division by zero is invalid', () => {
    expect(evaluate(classic)).toEqual(rat(24));
    expect(evaluate(mustParse('1/3+1/3+1/3'))).toEqual(rat(1));
    expect(evaluate(mustParse('6/(4-(3+1))'))).toBeNull();
    expect(evaluate(mustParse('999999999*999999999*999999999'))).toBeNull();
  });

  it('canonical form merges rearrangements and nothing else', () => {
    const same = (x: string, y: string): void => expect(canonicalKey(mustParse(x)), `${x} ≡ ${y}`).toBe(canonicalKey(mustParse(y)));
    const differ = (x: string, y: string): void =>
      expect(canonicalKey(mustParse(x)), `${x} ≢ ${y}`).not.toBe(canonicalKey(mustParse(y)));
    same('2+3', '3+2');
    same('(2+3)+4', '2+(3+4)');
    same('4+2+3', '3+(4+2)');
    same('8-(3-2)', '(8+2)-3');
    same('8-3-2', '8-(3+2)');
    same('2*3', '3*2');
    same('4*(6/3)', '(4*6)/3');
    same('8/(4/2)', '(8*2)/4');
    same('12/2/3', '12/(2*3)');
    same('5*1', '5/1');
    same('5+0', '5-0');
    differ('8-3', '3-8');
    differ('8/2', '2/8');
    differ('(2+3)*4', '2*4+3*4');
    differ('2*3', '2+3');
    differ('3+3', '3*2');
  });

  it('displays with the fewest brackets that keep the value', () => {
    expect(ascii(classic)).toBe('6 / (1 - 3 / 4)');
    expect(ascii(mustParse('((3*4)-2)'))).toBe('3 * 4 - 2');
    expect(ascii(mustParse('(8-(3-2))'))).toBe('8 - (3 - 2)');
    expect(ascii(mustParse('((8-3)-2)'))).toBe('8 - 3 - 2');
    expect(ascii(mustParse('(8+(3-2))'))).toBe('8 + 3 - 2');
    expect(ascii(mustParse('(2*(3+4))'))).toBe('2 * (3 + 4)');
    expect(ascii(mustParse('(12/(3*2))'))).toBe('12 / (3 * 2)');
    expect(ascii(mustParse('(12*(3/2))'))).toBe('12 * 3 / 2');
    expect(ascii(mustParse('(6-(-3))'))).toBe('6 - (-3)');
    expect(ascii(mustParse('(-3+5)'))).toBe('-3 + 5');
    expect(ascii(mustParse('(5-((-3)*2))'))).toBe('5 - (-3) * 2');
  });

  it('display tokens carry operator ids that the locale maps to glyphs (MK · and :)', () => {
    const mk = getLocale('mk').ops;
    const text = (e: TExpr): string =>
      displayTokens(e)
        .map((t) => (t.t === 'num' ? key(t.v) : t.t === 'op' ? ` ${mk[t.op]} ` : t.s))
        .join('');
    expect(text(mustParse('3*4-2'))).toBe('3 · 4 − 2');
    expect(text(mustParse('(12/(4-1))'))).toBe('12 : (4 − 1)');
  });
});

describe('target solver', () => {
  it('solves the classic deals exactly', () => {
    const cases: Array<[number[], string]> = [
      [[1, 3, 4, 6], '(6/(1-(3/4)))'],
      [[3, 3, 8, 8], '(8/(3-(8/3)))'],
      [[1, 5, 5, 5], '(5*(5-(1/5)))'],
    ];
    for (const [cards, repr] of cases) {
      const sols = solve(cards, 24, ALL);
      expect(sols.map((s) => s.repr), String(cards)).toEqual([repr]);
      expect(evaluate(sols[0]!.expr)).toEqual(rat(24));
      expect(sols[0]!.usesFraction).toBe(true);
      // Without fractions these deals cannot be solved.
      expect(solve(cards, 24, { ...ALL, allowFractionIntermediates: false })).toEqual([]);
    }
  });

  it('counts a+b and b+a (and other rearrangements) once', () => {
    expect(solve([2, 3], 5).map((s) => s.repr)).toEqual(['(3+2)']);
    expect(solve([3, 2], 5).map((s) => s.repr)).toEqual(['(3+2)']);
    expect(solve([5, 5], 10).map((s) => s.repr)).toEqual(['(5+5)']);
    expect(solve([1, 2, 3, 4], 10, { ops: ['+'], mustUseAll: true })).toHaveLength(1);
    const sols = solve([2, 3, 5, 7], 10, { mustUseAll: true });
    expect(new Set(sols.map((s) => canonicalKey(s.expr))).size).toBe(sols.length);
    expect(sols.every((s) => s.canon === canonicalKey(s.expr))).toBe(true);
  });

  it('finds exactly the canonical solutions an independent brute force finds', () => {
    const cases: Array<[number[], number, SolveOptions]> = [
      [[1, 3, 4, 6], 24, ALL],
      [[2, 3, 5, 7], 10, { mustUseAll: true }],
      [[2, 3, 5, 7], 10, {}],
      [[4, 4, 10, 10], 24, ALL],
      [[1, 1, 2, 6], 12, { ...ALL, mustUseAll: false }],
      [[2, 2, 3, 3], 12, { ops: ['+', '*'] }],
      [[-3, 4, 7, 2], 5, { ...ALL, allowFractionIntermediates: false }],
      [[6, 2, 9], 3, { allowNegativeIntermediates: true }],
    ];
    for (const [cards, target, o] of cases) {
      const res = solveDetailed(cards, target, { ...o, maxSolutions: 10_000 });
      const got = new Set(res.solutions.map((s) => s.canon));
      expect(got.size).toBe(res.total);
      expect(got, `${cards} -> ${target}`).toEqual(bruteCanon(cards, target, o));
      for (const s of res.solutions) assertSolves(s.expr, cards, target, o, `${cards} -> ${target}: ${s.repr}`);
    }
  });

  it('orders solutions simplest first and honours maxSolutions', () => {
    const res = solveDetailed([1, 3, 4, 6], 24, { ...ALL, mustUseAll: false, maxSolutions: 3 });
    expect(res.solutions).toHaveLength(3);
    expect(res.total).toBeGreaterThan(3);
    expect(res.solutions[0]!.repr).toBe('(6*4)');
    const all = solve([2, 3, 5, 7], 10, { ...ALL, mustUseAll: false });
    for (let i = 1; i < all.length; i++) expect(all[i]!.complexity).toBeGreaterThanOrEqual(all[i - 1]!.complexity);
    expect(all[0]!.ops).toBe(1);
  });

  it('Band A make-10 fast path: subset sums over up to six dot cards', () => {
    expect(solveMakeTen([3, 7, 5, 2, 8, 1]).map((s) => s.repr)).toEqual(['(7+3)', '(8+2)', '((5+3)+2)', '((7+2)+1)']);
    expect(solveMakeTen([1, 2, 3])).toEqual([]);
    const withSub = solveMakeTen([9, 4, 3, 2], 10, { allowSubtraction: true });
    expect(withSub.some((s) => s.opKinds.includes('-'))).toBe(true);
    for (const s of withSub) assertSolves(s.expr, [9, 4, 3, 2], 10, { ops: ['+', '-'] }, s.repr);
  });

  it('the fast path agrees with the general search', () => {
    const rng = createRng(3);
    for (let i = 0; i < 40; i++) {
      const cards = Array.from({ length: rng.int(3, 6) }, () => rng.int(0, 9));
      for (const o of [{ ops: ['+'] }, { ops: ['+', '-'] }, { ops: ['+', '-'], mustUseAll: true }] as SolveOptions[]) {
        const fast = solveDetailed(cards, 10, { ...o, maxSolutions: 10_000 });
        const slow = solveDetailed(cards, 10, { ...o, maxSolutions: 10_000 }, 'general');
        expect(new Set(fast.solutions.map((s) => s.canon)), `${cards} ${o.ops}`).toEqual(
          new Set(slow.solutions.map((s) => s.canon)),
        );
      }
    }
  });

  it('reports reachable values under the rules', () => {
    expect(reachableValues([1, 3, 4, 6], ALL).has('24')).toBe(true);
    expect(reachableValues([1, 3, 4, 6], { ...ALL, allowFractionIntermediates: false }).has('24')).toBe(false);
    expect([...reachableValues([2, 3], { mustUseAll: true }).keys()].sort()).toEqual(['1', '5', '6']);
    expect(() => solve([1, 2, 3, 4, 5, 6, 7], 24)).toThrow(RangeError);
  });

  it('a 4-card solve takes well under 20 ms (asserted < 60 ms for slow CI)', () => {
    const decks: number[][] = [
      [1, 3, 4, 6],
      [3, 3, 8, 8],
      [2, 5, 7, 11],
      [4, 9, 10, 13],
    ];
    const median = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    for (const cards of decks) solve(cards, 24, { ...ALL, mustUseAll: false }); // warm-up
    const times: number[] = [];
    for (let run = 0; run < 5; run++) {
      for (const cards of decks) {
        const t0 = performance.now();
        solve(cards, 24, { ...ALL, mustUseAll: false });
        times.push(performance.now() - t0);
      }
    }
    expect(median(times)).toBeLessThan(60);
    // Five cards stay reasonable.
    const t0 = performance.now();
    const five = solveDetailed([2, 3, 5, 7, 11], 24, ALL);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(five.total).toBeGreaterThan(0);
  });
});

describe('target checker', () => {
  const cards = [1, 3, 4, 6];
  const rules = { ops: TARGET_OPS, mustUseAll: true };

  it('accepts a correct build, in repr or plain infix', () => {
    for (const repr of ['(6/(1-(3/4)))', '6/(1-3/4)']) {
      const res = checkTargetRepr(repr, cards, 24, rules);
      expect(res.ok, repr).toBe(true);
      expect(res.value).toEqual(rat(24));
      expect(res.reason).toBeUndefined();
      expect(res.canon).toBe(solve(cards, 24, ALL)[0]!.canon);
    }
  });

  it('rejects reused cards, non-cards, wrong values, bad operators and unused cards', () => {
    expect(checkTargetRepr('((6*6)-(3*4))', cards, 24, rules)).toMatchObject({ ok: false, reason: 'reusedCard' });
    expect(checkTargetRepr('(8*3)', cards, 24, { ...rules, mustUseAll: false })).toMatchObject({
      ok: false,
      reason: 'notCard',
    });
    const wrong = checkTargetRepr('((6+4)+(3+1))', cards, 24, rules);
    expect(wrong).toMatchObject({ ok: false, reason: 'wrongValue' });
    expect(wrong.value).toEqual(rat(14));
    expect(checkTargetRepr('(6/(4-(3+1)))', cards, 24, rules)).toMatchObject({ ok: false, reason: 'wrongValue', value: null });
    expect(checkTargetRepr('(7-3)', [7, 3, 5], 4, { ops: ['+'], mustUseAll: false })).toMatchObject({
      ok: false,
      reason: 'badOp',
    });
    const partial = checkTargetRepr('(6*4)', cards, 24, rules);
    expect(partial).toMatchObject({ ok: false, reason: 'unused' });
    expect(partial.value).toEqual(rat(24));
    expect(checkTargetRepr('(6*4)', cards, 24, { ...rules, mustUseAll: false }).ok).toBe(true);
    // Duplicated cards may each be used once.
    expect(checkTargetRepr('(5+5)', [5, 5, 2], 10, { ops: ['+'], mustUseAll: false }).ok).toBe(true);
    expect(checkTargetRepr('((5+5)+5)', [5, 5, 2], 15, { ops: ['+'], mustUseAll: false }).reason).toBe('reusedCard');
  });

  it('rejects garbage input as parse', () => {
    for (const s of ['', 'hello', '6×4', '(6*4', '24', '6 * 4 )', 'x'.repeat(1000), null as unknown as string]) {
      const res = checkTargetRepr(s, cards, 24, rules);
      if (s === '24') expect(res.reason).toBe('notCard');
      else expect(res, JSON.stringify(s)).toMatchObject({ ok: false, reason: 'parse', value: null });
    }
  });

  it('reads item data defensively and checks against it', () => {
    const deal = makeDeal(createRng(5), 'B', 0.5);
    const data = toDealData(deal);
    expect(readDealData(JSON.parse(JSON.stringify(data)))).toEqual(data);
    for (const repr of data.ways) expect(checkDealRepr(data, repr).ok, repr).toBe(true);
    expect(checkDealRepr({ ...data, target: data.target + 1 }, data.ways[0]!).reason).toBe('wrongValue');
    for (const bad of [null, 5, 'x', {}, { ...data, cards: [] }, { ...data, cards: [1.5, 2] }, { ...data, ops: ['^'] }, { ...data, ways: [3] }]) {
      expect(readDealData(bad)).toBeNull();
      expect(checkDealRepr(bad, data.ways[0]!).ok).toBe(false);
    }
  });
});

describe('target deals', () => {
  const BANDS: TargetBand[] = ['A', 'B', 'C'];
  const LEVELS = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const SEEDS = 12;
  const deals: Array<{ band: TargetBand; level: number; seed: number; deal: TargetDeal }> = [];
  for (const band of BANDS)
    for (const level of LEVELS)
      for (let seed = 1; seed <= SEEDS; seed++) deals.push({ band, level, seed, deal: makeDeal(createRng(seed * 7919), band, level) });

  it('every deal is solvable, band-shaped, and its solutions check out', () => {
    for (const { band, level, seed, deal } of deals) {
      const label = `${band} L${level} s${seed}: ${deal.cards} -> ${deal.target}`;
      const { cards, target, rules } = deal;
      expect(deal.solutions.length, label).toBeGreaterThan(0);
      expect(deal.totalSolutions).toBeGreaterThanOrEqual(deal.solutions.length);
      expect(deal.achievedLevel).toBeGreaterThanOrEqual(0);
      expect(deal.achievedLevel).toBeLessThanOrEqual(1);
      for (const v of Object.values(deal.features)) expect(Number.isFinite(v), label).toBe(true);
      expect(cards).not.toContain(target);
      if (band === 'A') {
        expect(target).toBe(10);
        expect(cards.length).toBeGreaterThanOrEqual(3);
        expect(cards.length).toBeLessThanOrEqual(6);
        for (const c of cards) expect(c >= 1 && c <= 9, label).toBe(true);
        expect(rules).toEqual({ ops: ['+'], mustUseAll: false, allowNegativeIntermediates: false, allowFractionIntermediates: false });
      } else {
        expect(cards).toHaveLength(4);
        expect(rules.ops).toEqual(['+', '-', '*', '/']);
      }
      if (band === 'B') {
        for (const c of cards) expect(c >= 1 && c <= 12, label).toBe(true);
        expect(target >= 5 && target <= 100, label).toBe(true);
        expect(rules.allowNegativeIntermediates || rules.allowFractionIntermediates).toBe(false);
      }
      if (band === 'C') {
        for (const c of cards) expect(c !== 0 && c >= -9 && c <= 13, label).toBe(true);
        expect(target >= -30 && target <= 100 && target !== 0, label).toBe(true);
        expect(rules.allowNegativeIntermediates).toBe(true);
      }
      // The listed solutions are real, distinct, and pass the checker.
      expect(new Set(deal.solutions.map((s) => s.canon)).size).toBe(deal.solutions.length);
      for (const s of deal.solutions) {
        assertSolves(s.expr, cards, target, rules, `${label}: ${s.repr}`);
        expect(checkTargetRepr(s.repr, cards, target, rules).ok, `${label}: ${s.repr}`).toBe(true);
      }
      // An independent solve agrees on the count.
      expect(solveDetailed(cards, target, rules).total, label).toBe(deal.totalSolutions);
    }
  });

  it('is deterministic for a seed and varied across seeds', () => {
    const snap = (d: TargetDeal): string =>
      JSON.stringify([d.cards, d.target, d.rules, d.solutions.map((s) => s.repr), d.achievedLevel, d.features]);
    for (const band of BANDS) {
      for (const level of [0.1, 0.6, 0.95]) {
        expect(snap(makeDeal(createRng(99), band, level))).toBe(snap(makeDeal(createRng(99), band, level)));
      }
      const distinct = new Set(deals.filter((d) => d.band === band && d.level === 0.6).map((d) => snap(d.deal)));
      expect(distinct.size).toBeGreaterThanOrEqual(SEEDS - 2);
    }
  });

  it('harder levels give harder deals on average', () => {
    const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
    const at = (band: TargetBand, level: number): TargetDeal[] =>
      Array.from({ length: 16 }, (_, i) => makeDeal(createRng(1000 + i), band, level));
    for (const band of BANDS) {
      const lo = at(band, 0.1);
      const mid = at(band, 0.5);
      const hi = at(band, 0.9);
      const lvl = [lo, mid, hi].map((ds) => mean(ds.map((d) => d.achievedLevel)));
      expect(lvl[0]!, band).toBeLessThan(lvl[1]!);
      expect(lvl[1]!, band).toBeLessThan(lvl[2]!);
      const f = (ds: TargetDeal[], k: string): number => mean(ds.map((d) => d.features[k]!));
      // Fewer ways to win and more cards needed at the top.
      expect(f(hi, 'solutions'), band).toBeLessThanOrEqual(f(lo, 'solutions'));
      expect(f(hi, 'cardsNeeded'), band).toBeGreaterThan(f(lo, 'cardsNeeded'));
      if (band === 'A') expect(f(hi, 'cards')).toBeGreaterThan(f(lo, 'cards'));
      if (band !== 'A') {
        expect(f(hi, 'hardestOp'), band).toBeGreaterThan(f(lo, 'hardestOp'));
        expect(f(hi, 'mustUseAll'), band).toBeGreaterThan(f(lo, 'mustUseAll'));
        expect(Math.abs(f(hi, 'target')), band).toBeGreaterThan(Math.abs(f(lo, 'target')));
      }
      if (band === 'C') {
        expect(f(hi, 'needsFraction')).toBeGreaterThan(0.5);
        expect(f(lo, 'needsFraction')).toBe(0);
        expect(f(hi, 'needsNegative')).toBeGreaterThan(f(lo, 'needsNegative'));
      }
    }
  });
});

describe('target hints', () => {
  it('tiers name an operator, then one step, then two, from the best solution', () => {
    const best = solve([1, 3, 4, 6], 24, ALL)[0]!.expr;
    expect(solutionSteps(best)).toEqual([
      { a: rat(3), op: '/', b: rat(4), r: rat(3, 4) },
      { a: rat(1), op: '-', b: rat(3, 4), r: rat(1, 4) },
      { a: rat(6), op: '/', b: rat(1, 4), r: rat(24) },
    ]);
    expect(targetHints(best)).toEqual([
      { tier: 1, op: '/' },
      { tier: 2, steps: [{ a: rat(3), op: '/', b: rat(4), r: rat(3, 4) }] },
      {
        tier: 3,
        steps: [
          { a: rat(3), op: '/', b: rat(4), r: rat(3, 4) },
          { a: rat(1), op: '-', b: rat(3, 4), r: rat(1, 4) },
        ],
      },
    ]);
    // A one-step bond: tier 2 shows only where to start, and there is no tier 3.
    const bond = solveMakeTen([7, 3, 5])[0]!.expr;
    expect(targetHints(bond)).toEqual([
      { tier: 1, op: '+' },
      { tier: 2, steps: [], next: { a: rat(7), op: '+' } },
    ]);
    expect(targetHint(bond, 3)).toBeNull();
    // Two steps: tier 3 adds only the start of the last step.
    const two = mustParse('((4+2)*3)');
    expect(targetHint(two, 3)).toEqual({
      tier: 3,
      steps: [{ a: rat(4), op: '+', b: rat(2), r: rat(6) }],
      next: { a: rat(6), op: '*' },
    });
  });

  it('no tier ever contains the whole solution', () => {
    const check = (s: Solution, label: string): void => {
      const steps = solutionSteps(s.expr);
      const last = steps[steps.length - 1]!;
      const hints = targetHints(s.expr);
      expect(hints[0], label).toEqual({ tier: 1, op: expect.any(String) });
      if (hints[0]!.tier === 1) expect(s.opKinds as TargetOp[]).toContain(hints[0]!.op);
      expect(hints.map((h) => h.tier)).toEqual([1, 2, 3].slice(0, hints.length));
      for (const h of hints) {
        if (h.tier === 1) continue;
        expect(h.steps.length, label).toBeLessThan(steps.length);
        expect(h.steps.length + (h.next ? 1 : 0), label).toBeLessThanOrEqual(steps.length);
        expect(h.steps).not.toContainEqual(last);
        if (h.next) expect(Object.keys(h.next).sort()).toEqual(['a', 'op']);
      }
    };
    for (const band of ['A', 'B', 'C'] as const) {
      for (const level of [0, 0.3, 0.6, 0.9, 1]) {
        for (let seed = 0; seed < 6; seed++) {
          const d = makeDeal(createRng(500 + seed), band, level);
          for (const s of d.solutions.slice(0, 5)) check(s, `${band} ${d.cards} -> ${d.target}: ${s.repr}`);
        }
      }
    }
  });
});

// ── The mode: rendering, generators, checker, registration, metric ──────────
describe('Target mode integration', () => {
  const EN_CONV = getLocale('en').numbers;
  const NOW = Date.now();
  const bindings = GRAPH.playableSkills().flatMap((s) =>
    (s.gens ?? []).filter((g) => g.id === 'makeIt' || g.id === 'makeTen').map((g) => ({ skill: s.id, g })),
  );
  const itemFor = (skill: string, g: (typeof bindings)[number]['g'], level: number, seed: number): Item => ({
    ...getGenerator(g.id).generate(level, createRng(seed), g.config ?? {}),
    key: '1', skillId: skill, genId: g.id, genVersion: 1, seed,
  });
  const placed = (age: number, g: number): Profile => {
    const p = createProfile({ name: 'Ана', age, locale: 'mk', avatar: 'color.green' }, NOW);
    const skills = replay({ graph: GRAPH, model: glickoElo }, [{ type: 'event', ts: NOW - 1000, sid: null, name: EVENTS.PLACEMENT_DONE, data: { g, sd: 0.3 } }]);
    return { ...p, skills, placement: { done: true, state: null, g, sd: 0.3 } };
  };

  it('mk renders × as ·, ÷ as :, minus as −, with brackets only where needed', () => {
    expect(exprText(mustParse('3*4-2'), 'mk')).toBe('3 · 4 − 2');
    expect(exprText(mustParse('(12/(4-1))'), 'mk')).toBe('12 : (4 − 1)');
    expect(exprText(mustParse('(6-(-3))'), 'mk')).toBe('6 − (−3)');
    expect(exprText(mustParse('3*4-2'), 'en')).toBe('3 × 4 − 2');
    expect(exprText(mustParse('(8/(3-(8/3)))'), 'en')).toBe('8 ÷ (3 − 8 ÷ 3)');
    expect(valueText(rat(3, 4), 'mk')).toBe('3/4');
    expect(valueText(rat(-7, 2), 'mk')).toBe('−7/2');
    expect(valueText(rat(-12), 'mk')).toBe('−12');
  });

  it('binds deals to the planned skills: make 10 for Band A, focused deals for B and C', () => {
    expect(bindings.map((b) => `${b.skill}:${b.g.id}`).sort()).toEqual([
      'as.add.20:makeIt', 'as.bonds.10:makeTen', 'int.addsub:makeIt', 'md.div.facts:makeIt', 'md.mult.facts:makeIt',
    ]);
    expect(getGenerator('makeTen').capabilities).not.toContain('reading');
    expect(getGenerator('makeIt').capabilities).toContain('reading');
    for (const { skill, g } of bindings) {
      for (let seed = 1; seed <= 12; seed++) {
        const item = itemFor(skill, g, (seed % 5) / 4, seed);
        const d = targetData(item)!;
        const ways = d.ways.map(mustParse);
        const label = `${skill} ${d.cards} -> ${d.target}`;
        if (skill === 'md.mult.facts') expect(ways.every((e) => opsUsed(e).includes('*')), label).toBe(true);
        if (skill === 'md.div.facts') expect(ways.every((e) => opsUsed(e).includes('/')), label).toBe(true);
        if (skill === 'int.addsub') expect([...leaves(ways[0]!), ...intermediates(ways[0]!)].some((v) => v.n < 0), label).toBe(true);
        if (skill === 'as.add.20') {
          expect(d.ops, label).toEqual(['+', '-']);
          expect(d.target >= 11 && d.target <= 20, label).toBe(true);
        }
        if (skill === 'as.bonds.10') expect(d.band === 'A' && d.target === 10 && d.ops.join() === '+', label).toBe(true);
      }
    }
  });

  it('the target.expr checker grades the built expression, never a value the UI reports', () => {
    for (const { skill, g } of bindings) {
      const item = itemFor(skill, g, 0.6, 5);
      const d = targetData(item)!;
      for (const w of d.ways) expect(gradeResponse(item, { kind: 'built', value: null, repr: w }, EN_CONV), w).toMatchObject({ correct: true, invalid: false, given: w });
      const claimed = gradeResponse(item, { kind: 'built', value: rat(d.target), repr: `(${d.cards[0]}+${d.cards[1]})` }, EN_CONV);
      if (d.cards[0]! + d.cards[1]! !== d.target) expect(claimed.correct).toBe(false);
      expect(gradeResponse(item, { kind: 'built', value: rat(d.target), repr: '', data: { reveal: 1 } }, EN_CONV)).toMatchObject({ correct: false, invalid: false, given: 'reveal' });
      expect(gradeResponse(item, { kind: 'built', value: rat(d.target), repr: '((' }, EN_CONV).invalid).toBe(true);
      expect(gradeResponse(item, { kind: 'typed', raw: String(d.target) }, EN_CONV).invalid).toBe(true);
      expect(gradeResponse(item, { kind: 'built', value: null, repr: '(9999+1)' }, EN_CONV)).toMatchObject({ correct: false, misconception: 'target.notCard' });
    }
  });

  it('prompt text, voice lines and the ruler follow the deal', () => {
    const b = bindings.find((x) => x.skill === 'md.mult.facts')!;
    const itemB = itemFor(b.skill, b.g, 0.3, 2);
    const dB = targetData(itemB)!;
    expect(promptText(itemB, 'mk', 'B')).toMatch(dB.mustUseAll ? /^Направи \d+ со сите картички$/ : /^Направи \d+$/);
    expect(customVoice(itemB)).toEqual({ key: 'voice.target.make', params: { n: dB.target } });
    const a = bindings.find((x) => x.skill === 'as.bonds.10')!;
    const itemA = itemFor(a.skill, a.g, 0.3, 2);
    expect(customVoice(itemA)).toEqual({ key: 'voice.target.makeTen' });
    expect(itemA.solution.every((s) => s.k === 'hop')).toBe(true);
    expect(targetLine('B', [5, 6, 4, 3], 24)).toMatchObject({ min: 0, max: 50, flag: 24, labelEvery: 5 });
    expect(targetLine('C', [8, 4, 4, 2], -13)).toMatchObject({ min: -30, max: 0, flag: -13 });
    expect(targetLine('A', [9, 7, 3, 2], 10)).toMatchObject({ min: 0, max: 21, flag: 10 });
  });

  it('registers the mode: on by default, deals only, nothing returns, half evidence', () => {
    const m = getMode('target')!;
    expect(m).toMatchObject({ order: 20, requires: ['deal'], bands: ['A', 'B', 'C'], flag: 'mode.target', homeA: true });
    expect(m.maxReturns!(getBand('B'))).toBe(0);
    expect((['A', 'B', 'C'] as const).map((id) => m.plannedItems!(getBand(id), {}))).toEqual([5, 8, 10]);
    expect(m.plannedItems!(getBand('C'), { quick: true })).toBe(3);
    expect(isEnabled('mode.target', {}, {})).toBe(true);
    expect(isEnabled('mode.target', { 'mode.target': false }, {})).toBe(false);
    expect(modeEvidence('target')).toBe(0.5);
  });

  it('is ready once a deal skill can be scheduled; Band A sessions serve only make-10 deals', () => {
    const m = getMode('target')!;
    expect(m.ready!(createProfile({ name: 'Ана', age: 6, locale: 'mk', avatar: 'color.green' }, NOW))).toBe(false);
    expect(m.ready!(placed(6, 1.2))).toBe(false);
    expect(hasTargetWork(placed(7, 2.5))).toBe(true);
    expect(m.ready!(placed(9, 3.5))).toBe(true);
    const serve = (p: Profile, band: 'A' | 'B'): Item[] => {
      const engine = new SessionEngine(
        { graph: GRAPH, model: glickoElo, now: () => NOW },
        { skills: p.skills, placement: { done: true, state: null } },
        {
          sessionId: 's1', seed: 3, band: { id: band, targetP: 0.85, allowReading: band !== 'A', maxReturns: 0 },
          mode: { id: 'target', requires: ['deal'] }, plannedItems: 5, stretch: false, timed: false,
        },
      );
      const out: Item[] = [];
      for (let cur = engine.next(); cur; cur = engine.next()) {
        out.push(cur.item);
        engine.answer(cur, { response: { kind: 'built', value: null, repr: targetData(cur.item)!.ways[0]! }, latencyMs: 9000, hint: false, locale: 'mk', conv: EN_CONV, input: 'tap' });
      }
      return out;
    };
    const a = serve(placed(7, 2.5), 'A');
    expect(a.length).toBe(5);
    expect(a.every((it) => it.genId === 'makeTen' && it.prompt.kind === 'custom' && it.prompt.type === 'target.deal')).toBe(true);
    const b = serve(placed(9, 3.5), 'B');
    expect(b.length).toBe(5);
    expect(b.every((it) => targetData(it) !== null)).toBe(true);
  });

  it('a solve after hint tier k is logged with tier k (credit 1 − 0.25·k, from the hint ladder seam)', () => {
    const p = placed(9, 3.5);
    const engine = new SessionEngine(
      { graph: GRAPH, model: glickoElo, now: () => NOW },
      { skills: p.skills, placement: { done: true, state: null } },
      {
        sessionId: 's1', seed: 4, band: { id: 'B', targetP: 0.85, allowReading: true, maxReturns: 0 },
        mode: { id: 'target', requires: ['deal'] }, plannedItems: 4, stretch: false, timed: false,
      },
    );
    const tiers: Array<number | null | undefined> = [];
    for (let i = 0, cur = engine.next(); cur; i++, cur = engine.next()) {
      const tier = i % 4;
      const r = engine.answer(cur, { response: { kind: 'built', value: null, repr: targetData(cur.item)!.ways[0]! }, latencyMs: 9000, hint: tier > 0, hintTier: tier, locale: 'mk', conv: EN_CONV, input: 'tap' });
      expect(r.grade.correct).toBe(true);
      tiers.push(r.record?.tier);
    }
    expect(tiers).toEqual([0, 1, 2, 3]);
  });

  it('Many Ways reads target_way events (never item records) and needs 3 ways for one deal', () => {
    const p = { ...createProfile({ name: 'Марко', age: 9, locale: 'mk', avatar: 'color.green' }, NOW), band: 'B' as const };
    const way = (n: number, key = '1'): LogRecord => ({ type: 'event', ts: NOW, sid: 's1', name: EVENTS.TARGET_WAY, data: { key, canon: 'x', repr: '(1+2)', n } });
    const ctx = (log: LogRecord[]): EvalContext => ({ profile: p, now: NOW, today: dayKey(NOW), log, sessionId: 's1', graph: GRAPH, modesAvailable: 3, memo: new Map() });
    const metric = getMetric('target.ways')!;
    expect(metric.kind).toBe('exploration');
    expect(metric.compute(ctx([]), {})).toBe(0);
    expect(metric.compute(ctx([way(2), way(2, '2')]), {})).toBe(2);
    expect(evaluateAchievements(ACHIEVEMENTS, ctx([way(2), way(2, '2')]), 'item')).not.toContain('target.manyWays');
    expect(evaluateAchievements(ACHIEVEMENTS, ctx([way(2), way(3)]), 'item')).toContain('target.manyWays');
  });

  it('validateAchievements stays clean (nothing for correctness alone)', () => {
    expect(validateAchievements(ACHIEVEMENTS)).toEqual([]);
    expect(ACHIEVEMENTS.find((x) => x.id === 'target.manyWays')).toMatchObject({ category: 'exploration', bands: ['B', 'C'] });
  });
});
