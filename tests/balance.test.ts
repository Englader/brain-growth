import { describe, expect, it } from 'vitest';
import {
  applyMove,
  BALANCE_CHECK_ID,
  balanceChecker,
  balanceData,
  balanceHints,
  balanceMisconceptions,
  balanceSolutionSteps,
  balanceY,
  BALANCE_BLOCKED_KEYS,
  BALANCE_HINT_KEYS,
  BALANCE_HINT_THEN_KEYS,
  BALANCE_MISCONCEPTIONS,
  BALANCE_MOVE_KEYS,
  BALANCE_SOL_KEYS,
  BALANCE_UI_KEYS,
  checkBalance,
  coefs,
  describeMove,
  detectMisconception,
  eqn,
  equationKey,
  hasEmptyPan,
  holdsAt,
  isBlocked,
  isIsolated,
  isolatedValue,
  makeEquation,
  moveToken,
  needsBalloons,
  panTerms,
  parseMoveToken,
  parseTranscript,
  predictedErrors,
  readBalanceData,
  scaleView,
  solutionPath,
  solveEquation,
  startState,
  transcriptRepr,
  type BalanceMove,
  type BalanceSkill,
  type BalanceState,
  type Equation,
  type MadeEquation,
} from '../src/core/balance';
import { ACHIEVEMENTS, evaluateAchievements, validateAchievements } from '../src/core/achievements';
import { MODE_EVIDENCE } from '../src/core/engine/params';
import { compatibleBindings } from '../src/core/engine/scheduler';
import { FLAGS } from '../src/core/flags';
import { hasChecker } from '../src/core/items/checkers';
import { getCustomPrompt } from '../src/core/items/customPrompts';
import { getGenerator } from '../src/core/items/generators';
import { gradeResponse } from '../src/core/items/grade';
import type { GeneratedItem, Item } from '../src/core/items/types';
import type { ItemRecord } from '../src/core/log/types';
import { createProfile } from '../src/core/profile';
import { key, neg, rat } from '../src/core/rational';
import { createRng } from '../src/core/rng';
import { GRAPH } from '../src/core/skills';
import { dayKey } from '../src/core/time';
import { getLocale } from '../src/i18n/locales';
import { promptText } from '../src/i18n/render';
import '../src/modes';
import { getMode } from '../src/modes/registry';

const SKILLS: BalanceSkill[] = ['al.eq.onestep', 'al.eq.linear'];
const LEVELS = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1];

function sample(skill: BalanceSkill, n: number, seed = 1): MadeEquation[] {
  const rng = createRng(seed);
  const out: MadeEquation[] = [];
  for (let i = 0; i < n; i++) out.push(makeEquation(rng, skill, LEVELS[i % LEVELS.length]!));
  return out;
}

/** Transcript of a list of moves (all applied) followed by the value. */
const repr = (moves: BalanceMove[], value: number | string): string => [...moves.map(moveToken), `=${value}`].join(';');

describe('balance: equation model', () => {
  it('solves, checks isolation and draws the scale', () => {
    const e = eqn(2, 4, 0, 10);
    expect(solveEquation(e)).toEqual(rat(3));
    expect(holdsAt(e, 3)).toBe(true);
    expect(isolatedValue(e)).toBeNull();
    expect(isolatedValue(eqn(1, 0, 0, -4))).toBe(-4);
    expect(isolatedValue(eqn(0, 7, 1, 0))).toBe(7);
    expect(isolatedValue(eqn(-1, 0, 0, 4))).toBeNull();
    expect(solveEquation(eqn(2, 1, 2, 5))).toBeNull();
    expect(scaleView(eqn(-2, 5, 1, -3))).toEqual({
      left: { xBoxes: 0, xBalloons: 2, units: 5, balloons: 0 },
      right: { xBoxes: 1, xBalloons: 0, units: 0, balloons: 3 },
    });
    expect(panTerms({ x: 0, k: 0 })).toEqual([{ x: false, coef: 0 }]);
    expect(equationKey(eqn(-1, -3, 2, 6))).toBe('-x-3=2x+6');
    expect(equationKey(eqn(0, 5, 1, 0))).toBe('5=x');
    expect(needsBalloons(eqn(1, 7, 0, 3))).toBe(true); // x = −4
    expect(needsBalloons(eqn(1, 3, 0, 7))).toBe(false);
  });
});

describe('balance: generator', () => {
  it('every equation has integer coefficients and exactly one integer solution', () => {
    for (const skill of SKILLS) {
      for (const m of sample(skill, 700, 11)) {
        expect(coefs(m.eq).every(Number.isSafeInteger)).toBe(true);
        const s = solveEquation(m.eq);
        expect(s, equationKey(m.eq)).not.toBeNull();
        expect(s!.d).toBe(1);
        expect(s!.n).toBe(m.solution);
        expect(m.solution).not.toBe(0);
        expect(holdsAt(m.eq, m.solution)).toBe(true);
        expect(isolatedValue(m.eq)).toBeNull();
        expect(hasEmptyPan(m.eq), equationKey(m.eq)).toBe(false);
        expect(m.balloons).toBe(needsBalloons(m.eq));
        expect(m.achievedLevel).toBeGreaterThanOrEqual(0);
        expect(m.achievedLevel).toBeLessThanOrEqual(1);
        if (skill === 'al.eq.onestep') expect(m.path.length).toBe(1);
        else expect(m.path.length >= 2 || m.features.bothSides === 1, equationKey(m.eq)).toBe(true);
      }
    }
  });

  it('is deterministic for a seed', () => {
    for (const skill of SKILLS) {
      for (const lv of [0.2, 0.8]) {
        expect(makeEquation(createRng(42), skill, lv)).toEqual(makeEquation(createRng(42), skill, lv));
      }
    }
  });

  it('achieved level and the difficulty features rise with the requested level', () => {
    const at = (skill: BalanceSkill, lv: number) => {
      const rng = createRng(7 + Math.round(lv * 1000));
      const ms = Array.from({ length: 160 }, () => makeEquation(rng, skill, lv));
      const mean = (f: (m: MadeEquation) => number): number => ms.reduce((s, m) => s + f(m), 0) / ms.length;
      return {
        level: mean((m) => m.achievedLevel),
        neg: mean((m) => (m.balloons ? 1 : 0)),
        both: mean((m) => m.features.bothSides!),
        div: mean((m) => m.features.div!),
      };
    };
    for (const skill of SKILLS) {
      const rows = [0.1, 0.3, 0.5, 0.7, 0.9].map((lv) => at(skill, lv));
      for (let i = 1; i < rows.length; i++) expect(rows[i]!.level).toBeGreaterThan(rows[i - 1]!.level);
      expect(rows[0]!.neg).toBeLessThan(0.1);
      expect(rows[4]!.neg).toBeGreaterThan(0.9);
      if (skill === 'al.eq.linear') {
        expect(rows[0]!.both).toBe(0);
        expect(rows[4]!.both).toBeGreaterThan(0.9);
      } else {
        expect(rows[0]!.div).toBeLessThan(rows[4]!.div);
      }
    }
  });
});

describe('balance: moves', () => {
  const s0 = startState(eqn(2, 4, 0, 10), false);

  it('applies balanced moves to both pans', () => {
    const r = applyMove(s0, { op: 'sub', term: 'k', n: 4 });
    expect(isBlocked(r)).toBe(false);
    expect(equationKey((r as BalanceState).eq)).toBe('2x=6');
    const r2 = applyMove(r as BalanceState, { op: 'div', n: 2 });
    expect(isIsolated(r2 as BalanceState)).toBe(true);
    const r3 = applyMove(startState(eqn(3, 1, 1, 7), true), { op: 'sub', term: 'x', n: 1 });
    expect(equationKey((r3 as BalanceState).eq)).toBe('2x+1=7');
  });

  it('detects every kind of blocked move and leaves the scale alone', () => {
    const cases: Array<[BalanceMove, string]> = [
      [{ op: 'sub', term: 'k', n: 4, side: 'left' }, 'unbalanced'],
      [{ op: 'add', term: 'x', n: 1, side: 'right' }, 'unbalanced'],
      [{ op: 'div', n: 2, side: 'left' }, 'unbalanced'],
      [{ op: 'div', n: 4 }, 'nonInteger'],
      [{ op: 'div', n: 3 }, 'nonInteger'],
      [{ op: 'add', term: 'k', n: 0 }, 'noop'],
      [{ op: 'div', n: 1 }, 'noop'],
      [{ op: 'sub', term: 'k', n: 5 }, 'negative'], // 2x − 1 = 5 needs a balloon
      [{ op: 'sub', term: 'x', n: 1 }, 'negative'], // x + 4 = −x + 10
      [{ op: 'div', n: -2 }, 'negative'],
      [{ op: 'div', n: 0 }, 'invalid'],
      [{ op: 'add', term: 'k', n: 2.5 }, 'invalid'],
      [{ op: 'add', term: 'k', n: 1e6 }, 'invalid'],
    ];
    for (const [m, why] of cases) expect(applyMove(s0, m), JSON.stringify(m)).toEqual({ blocked: why });
    // With balloons the negative moves are fine.
    const c = startState(s0.eq, true);
    expect(isBlocked(applyMove(c, { op: 'sub', term: 'k', n: 5 }))).toBe(false);
    expect(equationKey((applyMove(c, { op: 'div', n: -2 }) as BalanceState).eq)).toBe('-x-2=-5');
  });

  it('writes and reads move tokens', () => {
    const moves: BalanceMove[] = [
      { op: 'add', term: 'k', n: 3, side: 'both' },
      { op: 'sub', term: 'k', n: 12, side: 'both' },
      { op: 'add', term: 'x', n: 1, side: 'both' },
      { op: 'sub', term: 'x', n: 7, side: 'both' },
      { op: 'div', n: -3, side: 'both' },
      { op: 'sub', term: 'k', n: 4, side: 'left' },
      { op: 'div', n: 2, side: 'right' },
    ];
    for (const m of moves) expect(parseMoveToken(moveToken(m))).toEqual(m);
    expect(moveToken({ op: 'sub', term: 'x', n: -2 })).toBe('+2x');
    expect(moveToken({ op: 'div', n: -1 })).toBe('/-1');
    expect(moveToken({ op: 'sub', term: 'k', n: 4, side: 'left' })).toBe('L:-4');
    for (const bad of ['', '+', '-x+', '*2', '/x', 'L-4', 'X:+1', '+3y', '++3']) expect(parseMoveToken(bad), bad).toBeNull();
  });
});

describe('balance: solution path', () => {
  it('solves every generated equation, and every move keeps the scale balanced', () => {
    for (const skill of SKILLS) {
      for (const m of sample(skill, 400, 5)) {
        const path = solutionPath(m.eq, m.balloons);
        expect(path, equationKey(m.eq)).not.toBeNull();
        expect(path).toEqual(m.path);
        let st = startState(m.eq, m.balloons);
        for (const mv of path!) {
          expect(mv.side ?? 'both').toBe('both');
          const r = applyMove(st, mv);
          expect(isBlocked(r), `${equationKey(st.eq)} ${moveToken(mv)}`).toBe(false);
          st = r as BalanceState;
          expect(holdsAt(st.eq, m.solution)).toBe(true);
          if (!m.balloons) expect(coefs(st.eq).every((v) => v >= 0)).toBe(true);
        }
        expect(isolatedValue(st.eq)).toBe(m.solution);
      }
    }
  });

  it('is as short as any path of arbitrary balanced moves (brute force)', () => {
    // Wide move set: any constant up to 70, any x-term up to 20, any division up to ±20.
    const wide: BalanceMove[] = [];
    for (let n = 1; n <= 70; n++) wide.push({ op: 'add', term: 'k', n }, { op: 'sub', term: 'k', n });
    for (let n = 1; n <= 20; n++) wide.push({ op: 'add', term: 'x', n }, { op: 'sub', term: 'x', n });
    for (let n = 2; n <= 20; n++) wide.push({ op: 'div', n }, { op: 'div', n: -n });
    wide.push({ op: 'div', n: -1 });
    const reachable = (s: BalanceState, depth: number): boolean => {
      if (isIsolated(s)) return true;
      if (depth === 0) return false;
      for (const mv of wide) {
        const r = applyMove(s, mv);
        if (!isBlocked(r) && reachable(r, depth - 1)) return true;
      }
      return false;
    };
    const eqs = [...sample('al.eq.onestep', 20, 3), ...sample('al.eq.linear', 40, 4)];
    for (const m of eqs) {
      const L = m.path.length;
      expect(reachable(startState(m.eq, m.balloons), L - 1), equationKey(m.eq)).toBe(false);
    }
  });

  it('returns [] when x is alone and null when there is no unique solution', () => {
    expect(solutionPath(eqn(1, 0, 0, 5))).toEqual([]);
    expect(solutionPath(eqn(2, 1, 2, 5))).toBeNull();
    // A negative solution needs balloons.
    expect(solutionPath(eqn(1, 7, 0, 3), false)).toBeNull();
    expect(solutionPath(eqn(1, 7, 0, 3), true)).toEqual([{ op: 'sub', term: 'k', n: 7 }]);
  });

  it('gathers x, then clears the weights, then splits (textbook order)', () => {
    expect(solutionPath(eqn(3, 2, 1, 10))!.map(moveToken)).toEqual(['-x', '-2', '/2']);
    expect(solutionPath(eqn(0, 26, 2, 20))!.map(moveToken)).toEqual(['-20', '/2']);
    expect(solutionPath(eqn(1, 3, 2, 1))!.map(moveToken)).toEqual(['-x', '-1']);
  });
});

describe('balance: hints', () => {
  it('builds tiers from the path without the resulting scale or x', () => {
    for (const skill of SKILLS) {
      for (const m of sample(skill, 120, 9)) {
        const st = startState(m.eq, m.balloons);
        const hints = balanceHints(st);
        const L = m.path.length;
        expect(hints.map((h) => h.tier)).toEqual(L === 1 ? [1, 2] : [1, 2, 3]);
        const [h1, h2, h3] = hints;
        expect(h1).toEqual({ tier: 1, kind: m.path[0]!.op === 'div' ? 'div' : (m.path[0] as { term: 'x' | 'k' }).term });
        expect(h2).toEqual({ tier: 2, move: m.path[0] });
        if (h3 && h3.tier === 3) {
          expect(h3.moves.length).toBeLessThan(L);
          expect(h3.moves).toEqual(m.path.slice(0, h3.moves.length));
          if (L === 2) expect(h3.nextKind).toBeDefined();
        }
        for (const h of hints) expect(Object.keys(h).sort()).not.toContain('value');
      }
    }
  });

  it('follows the child: hints come from the current scale', () => {
    const s1 = applyMove(startState(eqn(2, 4, 0, 10), false), { op: 'sub', term: 'k', n: 4 }) as BalanceState;
    expect(balanceHints(s1)).toEqual([
      { tier: 1, kind: 'div' },
      { tier: 2, move: { op: 'div', n: 2 } },
    ]);
    expect(balanceHints(applyMove(s1, { op: 'div', n: 2 }) as BalanceState)).toEqual([]);
  });
});

describe('balance: score and misconceptions', () => {
  it('scores 1 − 0.25 per blocked attempt, 0 on reveal', () => {
    expect(balanceY(0, false)).toBe(1);
    expect(balanceY(1, false)).toBe(0.75);
    expect(balanceY(3, false)).toBe(0.25);
    expect(balanceY(4, false)).toBe(0);
    expect(balanceY(9, false)).toBe(0);
    expect(balanceY(0, true)).toBe(0);
  });

  it('names the bug behind a wrong value', () => {
    const e = eqn(2, 4, 0, 10); // x = 3
    const cases: Array<[number, string]> = [
      [-3, 'balance.sign'],
      [7, 'balance.keptSign'], // 2x = 10 + 4
      [5, 'balance.oneSide'], // 2x = 10 (4 taken off the left only)
      [6, 'balance.noDivide'],
      [4, 'balance.subCoef'],
      [12, 'balance.mulCoef'],
      [1, 'balance.divPartial'], // x + 4 = 5
    ];
    for (const [v, code] of cases) expect(detectMisconception(e, rat(v)), String(v)).toBe(code);
    expect(detectMisconception(e, rat(3))).toBeNull();
    expect(detectMisconception(e, rat(9))).toBeNull();
    // x on both sides: 3x + 1 = x + 7 (x = 3); c·x taken off the right only gives 3x + 1 = 7.
    expect(detectMisconception(eqn(3, 1, 1, 7), rat(2))).toBe('balance.oneSide');
    expect(detectMisconception(eqn(3, 1, 1, 7), rat(3, 2))).toBe('balance.keptSign');
    // x on the right pan reads the same way.
    expect(detectMisconception(eqn(0, 10, 2, 4), rat(-3))).toBe('balance.sign');
    // Every predicted code is listed, and integer predictions feed the item list.
    for (const skill of SKILLS) {
      for (const m of sample(skill, 200, 13)) {
        for (const p of predictedErrors(m.eq)) {
          expect(BALANCE_MISCONCEPTIONS).toContain(p.code);
          expect(p.value).not.toEqual(rat(m.solution));
        }
        for (const x of balanceMisconceptions(m.eq)) expect(Number.isInteger(x.value)).toBe(true);
      }
    }
  });
});

describe('balance: checker', () => {
  const e: Equation = eqn(2, 4, 0, 10);
  const data = balanceData(e, false);

  it('accepts the shortest path and every other balanced route', () => {
    const r = checkBalance(data, '-4;/2;=3');
    expect(r).toMatchObject({ ok: true, isolated: true, moves: 2, penalised: 0, optimal: true });
    expect(r.given).toBe('-4;/2;=3');
    // A longer but legal route is still correct, just not optimal.
    expect(checkBalance(data, '+2;-6;/2;=3')).toMatchObject({ ok: true, optimal: false, moves: 3 });
    for (const skill of SKILLS) {
      for (const m of sample(skill, 200, 17)) {
        const res = checkBalance(balanceData(m.eq, m.balloons), repr(m.path, m.solution));
        expect(res.ok, equationKey(m.eq)).toBe(true);
        expect(res.optimal).toBe(true);
      }
    }
  });

  it('recounts blocked attempts from the replay and charges only unbalanced ones', () => {
    const r = checkBalance(data, '!L:-4;!/4;!+0;-4;!R:/2;/2;=3');
    expect(r.ok).toBe(true);
    expect(r.blocked).toEqual({ unbalanced: 2, nonInteger: 1, noop: 1, negative: 0, invalid: 0 });
    expect(r.penalised).toBe(2);
    expect(balanceY(r.penalised, false)).toBe(0.5);
  });

  it('rejects forged transcripts', () => {
    // A one-pan move claimed as made: the replay refuses it, so the scale never gets to x = 3.
    expect(checkBalance(data, 'L:-4;/2;=3')).toMatchObject({ ok: false, reason: 'forged' });
    // A split into 4 claimed as made.
    expect(checkBalance(data, '-4;/4;/2;=3')).toMatchObject({ ok: false, reason: 'forged' });
    // A legal move claimed as refused (to dodge nothing, but the log would lie).
    expect(checkBalance(data, '!-4;-4;/2;=3')).toMatchObject({ ok: false, reason: 'forged' });
    // The right value with no work, when x must be isolated first.
    expect(checkBalance(data, '=3')).toMatchObject({ ok: false, reason: 'notIsolated', isolated: false });
    expect(checkBalance(data, '-4;=3')).toMatchObject({ ok: false, reason: 'notIsolated' });
    // …which an item with iso: 0 allows.
    expect(checkBalance(balanceData(e, false, false), '=3')).toMatchObject({ ok: true, isolated: false });
    // Balloons are re-derived from the data, not the UI: a Band B scale cannot go negative.
    expect(checkBalance(data, '-10;/2;+2;=3')).toMatchObject({ ok: false, reason: 'forged' });
    // An undo with nothing to undo.
    expect(checkBalance(data, 'u;-4;/2;=3')).toMatchObject({ ok: false, reason: 'forged' });
  });

  it('replays undos and treats "show me" as a wrong attempt', () => {
    // Undo a split: the scale goes back to 2x = 6.
    expect(checkBalance(data, '-4;/2;u;/2;=3')).toMatchObject({ ok: true, moves: 3, undos: 1, optimal: false });
    expect(checkBalance(data, '-4;u;=3')).toMatchObject({ ok: false, reason: 'notIsolated' });
    expect(checkBalance(data, '-4;=?')).toMatchObject({ ok: false, reason: 'revealed', value: null, misconception: null });
  });

  it('marks a wrong value with its misconception', () => {
    expect(checkBalance(data, '-4;/2;=-3')).toMatchObject({ ok: false, reason: 'wrongValue', misconception: 'balance.sign' });
    expect(checkBalance(balanceData(e, false, false), '=7')).toMatchObject({ reason: 'wrongValue', misconception: 'balance.keptSign' });
    expect(checkBalance(balanceData(e, false, false), '=9')).toMatchObject({ reason: 'wrongValue', misconception: null });
  });

  it('treats malformed data or repr as unreadable', () => {
    for (const bad of ['', '-4;/2', '-4;/2;=', '-4;;/2;=3', '-4;/2;=3;', '-4;/2;=3/0', 'x;=3', '-4;/2;= 3']) {
      expect(checkBalance(data, bad), bad).toMatchObject({ ok: false, reason: 'parse', value: null });
    }
    expect(checkBalance(data, `${'+1;-1;'.repeat(101)}=3`).reason).toBe('parse');
    expect(checkBalance({ a: 2, b: 1, c: 0, d: 4 }, '=1').reason).toBe('parse'); // x = 3/2
    expect(checkBalance({ a: 2, b: 1, c: 2, d: 4 }, '=1').reason).toBe('parse'); // no solution
    expect(checkBalance({ a: '2', b: 4, c: 0, d: 10 }, '=3').reason).toBe('parse');
    expect(checkBalance(null, '=3').reason).toBe('parse');
    expect(readBalanceData({ a: 1, b: 7, c: 0, d: 3, bal: 0 })).toBeNull(); // negative x without balloons
    expect(readBalanceData({ a: 1, b: 7, c: 0, d: 3 })).toMatchObject({ balloons: true, requireIsolated: true });
  });

  it('round-trips transcripts', () => {
    const t = parseTranscript('!L:-4;-4;/2;=3')!;
    expect(t.entries.map((e) => e.kind === 'move' && e.claimedBlocked)).toEqual([true, false, false]);
    expect(transcriptRepr(parseTranscript('-4;u;-4;/2;=?')!)).toBe('-4;u;-4;/2;=?');
    expect(parseTranscript('-4;u;=?')!.value).toBeNull();
    expect(t.value).toEqual(rat(3));
    expect(transcriptRepr(t)).toBe('!L:-4;-4;/2;=3');
    expect(parseTranscript('-2x;=-7/2')!.value).toEqual(rat(-7, 2));
  });
});

describe('balance: message keys', () => {
  it('emits only listed keys', () => {
    const moveKeys = new Set(Object.values(BALANCE_MOVE_KEYS));
    const solKeys = new Set<string>(Object.values(BALANCE_SOL_KEYS));
    for (const skill of SKILLS) {
      for (const m of sample(skill, 150, 21)) {
        for (const step of balanceSolutionSteps(m.eq, m.balloons)) {
          expect(step.k).toBe('say');
          if (step.k === 'say') expect(solKeys).toContain(step.key);
        }
        for (const mv of m.path) {
          const d = describeMove(mv);
          expect(moveKeys).toContain(d.key);
          expect(d.params.n).not.toBe(0);
          expect(mv.op === 'div' || d.params.n > 0).toBe(true);
        }
        for (const h of balanceHints(startState(m.eq, m.balloons))) {
          if (h.tier === 1) expect(BALANCE_HINT_KEYS[h.kind]).toMatch(/^balance\.hint\./);
          if (h.tier === 3 && h.nextKind) expect(BALANCE_HINT_THEN_KEYS[h.nextKind]).toMatch(/^balance\.hint\.then\./);
        }
      }
    }
    const last = balanceSolutionSteps(eqn(2, 4, 0, 10), false).at(-1)!;
    expect(last).toEqual({ k: 'say', key: 'sol.balance.result', params: { x: 3 } });
    expect(Object.keys(BALANCE_BLOCKED_KEYS).sort()).toEqual(['invalid', 'negative', 'nonInteger', 'noop', 'unbalanced']);
    for (const code of BALANCE_MISCONCEPTIONS) expect(code).toMatch(/^balance\.[a-z][A-Za-z]+$/);
    expect(describeMove({ op: 'sub', term: 'x', n: -2 })).toEqual({ key: 'balance.move.addX', params: { n: 2 } });
  });
});

describe('balance: registry adapter', () => {
  it('grades a built response from params and repr, ignoring the UI value', () => {
    // Payloads are plain number records, so they fit `answer.check.params` as they are.
    const params: Record<string, number> = balanceData(eqn(2, 4, 0, 10), false);
    const item = {} as Item;
    const conv = getLocale('mk').numbers;
    const built = (r: string) => ({ kind: 'built' as const, value: rat(3), repr: r });
    expect(balanceChecker(item, built('-4;/2;=3'), params, conv)).toEqual({
      correct: true,
      invalid: false,
      given: '-4;/2;=3',
      misconception: null,
      delta: 0,
    });
    expect(balanceChecker(item, built('-4;/2;=-3'), params, conv)).toMatchObject({ correct: false, misconception: 'balance.sign', delta: -6 });
    expect(balanceChecker(item, built('L:-4;/2;=3'), params, conv)).toMatchObject({ correct: false, invalid: false });
    expect(balanceChecker(item, built('?'), params, conv)).toMatchObject({ correct: false, invalid: true });
    expect(balanceChecker(item, { kind: 'typed', raw: '3' }, params, conv)).toMatchObject({ correct: false, invalid: true });
    expect(BALANCE_CHECK_ID).toBe('balance.eq');
  });

  it('honours the balloons the scale showed (Band C), which can only make more moves legal', () => {
    const params: Record<string, number> = balanceData(eqn(2, 4, 0, 10), false);
    const conv = getLocale('mk').numbers;
    const repr = '-10;/2;+3;=3'; // passes through 2x − 6 = 0: needs balloons
    expect(balanceChecker({} as Item, { kind: 'built', value: null, repr }, params, conv).correct).toBe(false);
    expect(balanceChecker({} as Item, { kind: 'built', value: null, repr, data: { bal: 1 } }, params, conv).correct).toBe(true);
  });
});

// ── Integration with the item pipeline, engine eligibility, modes and achievements ──

const T0 = new Date(2026, 9, 5, 16, 0).getTime();
const asItem = (g: GeneratedItem, skillId: string, genId: string, seed: number): Item => ({ ...g, key: '1', skillId, genId, genVersion: 1, seed });

describe('balance: integration', () => {
  it('every key the core lists has a string in en and mk', () => {
    const listed = [
      ...BALANCE_UI_KEYS,
      ...Object.values(BALANCE_MOVE_KEYS),
      ...Object.values(BALANCE_HINT_KEYS),
      ...Object.values(BALANCE_HINT_THEN_KEYS),
      ...Object.values(BALANCE_BLOCKED_KEYS),
      ...Object.values(BALANCE_SOL_KEYS),
      ...BALANCE_MISCONCEPTIONS.flatMap((c) => [`mis.${c}.name`, `mis.${c}.tip`]),
    ];
    for (const loc of ['en', 'mk']) expect(listed.filter((k) => !(k in getLocale(loc).messages)), loc).toEqual([]);
  });

  it('registers its checker and prompts once, and grades generated items through gradeResponse', () => {
    expect(hasChecker('balance.eq')).toBe(true);
    expect(getCustomPrompt('balance.eq')).toBeDefined();
    expect(getCustomPrompt('balance.bond')).toBeDefined();
    const conv = getLocale('mk').numbers;
    for (let seed = 1; seed <= 40; seed++) {
      const skill = seed % 2 ? 'al.eq.onestep' : 'al.eq.linear';
      const item = asItem(getGenerator('equation').generate(seed / 40, createRng(seed), { skill }), skill, 'equation', seed);
      expect(item.prompt.kind).toBe('custom');
      const d = readBalanceData(item.prompt.kind === 'custom' ? item.prompt.data : null)!;
      const moves = solutionPath(d.eq, d.balloons)!.map(moveToken);
      const x = item.answer.value;
      expect(gradeResponse(item, { kind: 'built', value: null, repr: [...moves, `=${key(x)}`].join(';') }, conv).correct).toBe(true);
      expect(gradeResponse(item, { kind: 'built', value: null, repr: [...moves, `=${key(neg(x))}`].join(';') }, conv)).toMatchObject({
        correct: false,
        invalid: false,
        misconception: 'balance.sign',
      });
      expect(gradeResponse(item, { kind: 'built', value: null, repr: 'nonsense' }, conv).invalid).toBe(true);
      expect(promptText(item, 'mk', 'C')).toBe('Држи ги двете страни еднакви додека непознатата x не остане сама.');
    }
  });

  it('serves equations to Balance only, and al.eq.onestep to Hop as a missing number on a signed line', () => {
    const hop = { requires: ['numberLine'] as const, allowReading: false };
    const build = { requires: ['build'] as const, allowReading: false };
    expect(compatibleBindings(GRAPH.get('al.eq.onestep'), hop).map((b) => b.id)).toEqual(['eqBond']);
    expect(compatibleBindings(GRAPH.get('al.eq.linear'), hop)).toEqual([]);
    expect(compatibleBindings(GRAPH.get('al.eq.onestep'), build).map((b) => b.id)).toEqual(['equation']);
    expect(compatibleBindings(GRAPH.get('al.eq.linear'), build).map((b) => b.id)).toEqual(['equation']);
    const bond = asItem(getGenerator('eqBond').generate(0.9, createRng(4), {}), 'al.eq.onestep', 'eqBond', 4);
    const text = promptText(bond, 'mk', 'C');
    expect(text.startsWith('Одреди го непознатиот број: ')).toBe(true);
    expect(text).toContain('?');
    expect(text).not.toMatch(/[-*/]/); // Macedonian glyphs only: − · :
  });

  it('registers the mode: order 52, build, Bands B/C, a default-on flag, 0.75 evidence, unlock-gated', () => {
    const m = getMode('balance')!;
    expect(m).toMatchObject({ order: 52, requires: ['build'], bands: ['B', 'C'], flag: 'mode.balance', notReadyKey: 'balance.locked' });
    expect(FLAGS.find((f) => f.id === 'mode.balance')).toMatchObject({ default: true, labelKey: 'balance.flag' });
    expect(MODE_EVIDENCE.balance).toBe(0.75);
    expect(m.filter?.(GRAPH.get('al.eq.linear'), undefined)).toBe(true);
    expect(m.filter?.(GRAPH.get('geo.coord'), undefined)).toBe(false);
    const p = createProfile({ name: 'Ема', age: 13, locale: 'mk', avatar: 'color.green' }, T0);
    expect(m.ready?.(p)).toBe(false);
    const placed = { ...p, placement: { done: true, state: null } };
    expect(m.ready?.(placed)).toBe(false);
    const solid = Object.fromEntries(GRAPH.effectivePrereqs('al.eq.onestep').map((id) => [id, { proficientAt: T0 }]));
    expect(m.ready?.({ ...placed, skills: solid as unknown as typeof p.skills })).toBe(true);
  });

  it('keeps the achievement catalogue valid; balance.recovered rewards solving after a refused move', () => {
    expect(validateAchievements(ACHIEVEMENTS)).toEqual([]);
    const profile = { ...createProfile({ name: 'Ема', age: 13, locale: 'mk', avatar: 'color.green' }, T0), band: 'C' as const };
    const rec = (answer: string, correct: boolean): ItemRecord => ({
      type: 'item', ts: T0, sid: 's1', key: '1', skill: 'al.eq.linear', gen: 'equation', genV: 1, seed: 1, level: 0.5, diff: 0,
      p: 0.8, mu: 0, s2: 1, correct, attempt: 1, latency: 9000, hint: true, answer, expected: '3', mis: null, mode: 'balance',
      band: 'C', locale: 'mk', source: 'frontier', timed: false, input: 'typed', hops: null, alt: false,
    });
    const ctx = (log: ItemRecord[]) => ({ profile, now: T0, today: dayKey(T0), log, sessionId: 's1', graph: GRAPH, modesAvailable: 3, memo: new Map() });
    expect(evaluateAchievements(ACHIEVEMENTS, ctx([rec('-4;/2;=3', true)]), 'item')).not.toContain('balance.recovered');
    expect(evaluateAchievements(ACHIEVEMENTS, ctx([rec('!L:-4;-4;/2;=7', false)]), 'item')).not.toContain('balance.recovered');
    expect(evaluateAchievements(ACHIEVEMENTS, ctx([rec('!L:-4;-4;/2;=3', true)]), 'item')).toContain('balance.recovered');
  });
});
