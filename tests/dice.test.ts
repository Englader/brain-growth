import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import '../src/modes';
import { answerTurn, beginTurn, chooseOption, endTurn, quitMatch, rollTurn, startMatch } from '../src/app/diceActions';
import { saveProfile } from '../src/app/persist';
import { repo } from '../src/app/services';
import { getState, setState } from '../src/app/store';
import { glickoElo } from '../src/core/engine/glicko';
import type { SkillState } from '../src/core/engine/model';
import { replay } from '../src/core/engine/replay';
import type { Response } from '../src/core/items/grade';
import { getGenerator } from '../src/core/items/generators/registry';
import type { GeneratedItem, Operands } from '../src/core/items/types';
import { EVENTS, type EventRecord, type ItemRecord, type LogRecord, type SessionRecord } from '../src/core/log/types';
import { createProfile, type Profile } from '../src/core/profile';
import { toNumber } from '../src/core/rational';
import { GRAPH } from '../src/core/skills';
import { moveItem, moveSkill, opsForSkills } from '../src/modes/dice/rules';
import { getDice } from '../src/modes/dice/state';
import {
  applyMove,
  boardFor,
  createMatch,
  DICE_KEYS,
  diceOpsFor,
  expectedTurns,
  FORM_DIE,
  greedyPolicy,
  isFinished,
  LANES,
  laddersValid,
  laneSpec,
  matchSummary,
  moveOptions,
  newLane,
  playMove,
  roll,
  rollDice,
  type DiceItemSpec,
  type DiceOp,
  type DiceRoll,
  type LaneState,
  type MatchState,
  type MoveOption,
} from '../src/core/dice';
import { createRng } from '../src/core/rng';
import { SKILLS } from '../src/core/skills/catalog';
import type { BandId } from '../src/core/types';

const ALL: DiceOp[] = ['+', '-', '*'];
const B = (d1: number, d2: number): DiceRoll => ({ band: 'B', dice: [d1, d2] });
const at = (lane: LaneState, position: number): LaneState => ({ ...lane, position });
const opsOf = (options: MoveOption[]): string[] => options.map((o) => o.op);

describe('dice boards', () => {
  it('A is pads 0…20 and C is −10…+15, neither with ladders', () => {
    const a = boardFor('A', 1);
    expect([a.start, a.finish, a.floor, a.ladders.length]).toEqual([0, 20, 0, 0]);
    const c = boardFor('C', 1);
    expect([c.start, c.finish, c.floor, c.ladders.length]).toEqual([-10, 15, -10, 0]);
  });

  it('B ladders are valid for every seed, with and without ×', () => {
    for (const ops of [ALL, ['+', '-'] as DiceOp[]]) {
      const spec = laneSpec('B', ops);
      for (let seed = 0; seed < 1500; seed++) {
        const b = boardFor('B', seed, ops);
        expect(laddersValid(b.ladders, spec), `seed ${seed} ${ops.join('')}`).toBe(true);
        for (const l of b.ladders) {
          expect(l.foot).toBeGreaterThan(b.start);
          expect(l.top).toBeGreaterThan(l.foot);
          expect(l.top).toBeLessThan(b.finish);
        }
      }
    }
  });

  it('the validity check rejects chains, overlaps and ladders into the finish', () => {
    const spec = laneSpec('B', ['+', '-']); // 3 ladders, climb 5–10, finish 42
    expect(laddersValid([{ foot: 5, top: 12 }, { foot: 12, top: 20 }, { foot: 25, top: 31 }], spec)).toBe(false); // chain
    expect(laddersValid([{ foot: 5, top: 12 }, { foot: 6, top: 14 }, { foot: 25, top: 31 }], spec)).toBe(false); // feet too close
    expect(laddersValid([{ foot: 5, top: 12 }, { foot: 15, top: 22 }, { foot: 32, top: 40 }], spec)).toBe(false); // top at finish − 2
    expect(laddersValid([{ foot: 5, top: 12 }, { foot: 15, top: 22 }], spec)).toBe(false); // wrong count
    expect(laddersValid([{ foot: 5, top: 12 }, { foot: 15, top: 22 }, { foot: 25, top: 31 }], spec)).toBe(true);
  });

  it('boards are deterministic per seed and vary between seeds', () => {
    expect(boardFor('B', 42)).toEqual(boardFor('B', 42));
    const layouts = new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(boardFor('B', s).ladders)));
    expect(layouts.size).toBeGreaterThan(15);
  });

  it('B lane length depends on whether × is available', () => {
    expect(boardFor('B', 1, ALL).finish).toBe(LANES.B.finish);
    expect(boardFor('B', 1, ['+', '*']).finish).toBe(LANES.B.finish);
    expect(boardFor('B', 1, ['+', '-']).finish).toBe(LANES.Bplus.finish);
    expect(boardFor('B', 1, ['+']).finish).toBe(LANES.Bplus.finish);
  });
});

describe('dice fairness (Monte Carlo)', () => {
  const cases: Array<[string, BandId, DiceOp[]]> = [
    ['A', 'A', []],
    ['B +−×', 'B', ALL],
    ['B +×', 'B', ['+', '*']],
    ['B +−', 'B', ['+', '-']],
    ['B +', 'B', ['+']],
    ['C', 'C', []],
  ];
  const means = new Map(cases.map(([name, band, ops]) => [name, expectedTurns(band, ops, 4000, 11).mean]));

  it('expected turns per band are within ±15% of each other', () => {
    const xs = [...means.values()];
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    expect(hi / lo, JSON.stringify(Object.fromEntries(means))).toBeLessThanOrEqual(1.15);
  });

  it('a Band A match takes about 6 turns per child', () => {
    expect(means.get('A')!).toBeGreaterThan(5.5);
    expect(means.get('A')!).toBeLessThan(7);
  });

  it('every B board is individually fair, not just on average', () => {
    const a = means.get('A')!;
    for (const ops of [ALL, ['+', '-'] as DiceOp[]]) {
      for (let seed = 0; seed < 12; seed++) {
        const board = boardFor('B', seed, ops);
        const rng = createRng(seed + 99);
        let turns = 0;
        for (let i = 0; i < 1500; i++) {
          let lane = newLane(board);
          while (!isFinished(lane)) lane = applyMove(lane, greedyPolicy(moveOptions(board, lane.position, roll(rng, 'B'), ops))).lane;
          turns += lane.turns;
        }
        const mean = turns / 1500;
        expect(mean / a).toBeGreaterThan(0.85);
        expect(mean / a).toBeLessThan(1.15);
      }
    }
  });
});

describe('dice moves', () => {
  it('Band A: a = position, b = dots, always forward, within 20', () => {
    const board = boardFor('A', 1);
    const [o] = moveOptions(board, 7, { band: 'A', dots: 4 });
    expect(o!.item).toEqual({ skillHint: 'as.add.20', a: 7, op: '+', b: 4, expected: 11 });
    expect([o!.target, o!.capped]).toEqual([11, false]);
    expect(moveOptions(board, 0, { band: 'A', dots: 3 })[0]!.item.skillHint).toBe('as.add.10');
  });

  it('Band A: near the pond the move stops there, and the item is the hops actually needed', () => {
    const [o] = moveOptions(boardFor('A', 1), 17, { band: 'A', dots: 5 });
    expect(o!.item).toEqual({ skillHint: 'as.add.20', a: 17, op: '+', b: 3, expected: 20 });
    expect([o!.target, o!.capped]).toEqual([20, true]);
  });

  it('Band B: options follow the unlocked operators', () => {
    const board = boardFor('B', 3);
    expect(opsOf(moveOptions(board, 0, B(3, 4), ['+']))).toEqual(['+']);
    expect(opsOf(moveOptions(board, 0, B(3, 4), ['+', '-']))).toEqual(['+', '-']);
    expect(opsOf(moveOptions(board, 0, B(3, 4), ALL))).toEqual(['+', '-', '*']);
    expect(opsOf(moveOptions(board, 0, B(3, 4), []))).toEqual(['+']); // + is always there
    const items = moveOptions(board, 0, B(3, 4), ALL).map((o) => o.item);
    expect(items).toEqual([
      { skillHint: 'as.add.10', a: 3, op: '+', b: 4, expected: 7 },
      { skillHint: 'as.sub.10', a: 4, op: '-', b: 3, expected: 1 },
      { skillHint: 'md.mult.facts', a: 3, op: '*', b: 4, expected: 12 },
    ]);
  });

  it('Band B: a double never offers a zero move, and skill hints fit the fact', () => {
    const board = boardFor('B', 3);
    expect(opsOf(moveOptions(board, 0, B(3, 3), ALL))).toEqual(['+', '*']);
    expect(moveOptions(board, 0, B(6, 5), ['+'])[0]!.item.skillHint).toBe('as.add.20');
    expect(moveOptions(board, 0, B(2, 6), ALL).find((o) => o.op === '*')!.item.skillHint).toBe('md.mult.2510');
  });

  it('diceOpsFor maps unlocked skills to operators', () => {
    expect(diceOpsFor(() => false)).toEqual(['+']);
    expect(diceOpsFor((s) => s === 'md.mult.facts')).toEqual(['+', '*']);
    expect(diceOpsFor(() => true)).toEqual(['+', '-', '*']);
  });

  it('Band B: landing on a ladder foot climbs it; − can be the move that hits it', () => {
    const board = boardFor('B', 5);
    const ladder = board.ladders[1]!;
    // From foot − 2, dice (5, 3): + lands on foot + 6, − lands exactly on the foot.
    const options = moveOptions(board, ladder.foot - 2, B(5, 3), ALL);
    const minus = options.find((o) => o.op === '-')!;
    expect(minus.land).toBe(ladder.foot);
    expect(minus.target).toBe(ladder.top);
    expect(minus.ladder).toEqual(ladder);
    const result = applyMove(at(newLane(board), ladder.foot - 2), minus);
    expect(result.lane.position).toBe(ladder.top);
    expect(result.notes).toContainEqual({ key: DICE_KEYS.ladder, params: { from: ladder.foot, to: ladder.top } });
  });

  it('Band B: the token stops at the finish; the fact itself is unchanged', () => {
    const board = boardFor('B', 1);
    const [plus] = moveOptions(board, board.finish - 3, B(6, 6), ['+']);
    expect(plus!.item.expected).toBe(12);
    expect([plus!.target, plus!.capped]).toEqual([board.finish, true]);
  });

  it('Band C: the form decides the direction; a − (−b) moves forward', () => {
    const board = boardFor('C', 1);
    const fwd = moveOptions(board, -3, { band: 'C', n: 4, form: 'a-(-b)' })[0]!;
    expect(fwd.item).toEqual({ skillHint: 'int.addsub', a: -3, op: '-', b: -4, expected: 1 });
    expect(fwd.target).toBe(1);
    const back = moveOptions(board, 5, { band: 'C', n: 4, form: 'a+(-b)' })[0]!;
    expect(back.item).toEqual({ skillHint: 'int.addsub', a: 5, op: '+', b: -4, expected: 1 });
    expect(back.target).toBe(1);
    const plain = moveOptions(board, -2, { band: 'C', n: 5, form: 'a-b' })[0]!;
    expect([plain.item.op, plain.item.b, plain.target]).toEqual(['-', 5, -7]);
  });

  it('Band C: a backward roll that would leave the lane bounces to its forward twin', () => {
    const board = boardFor('C', 1);
    const o = moveOptions(board, -8, { band: 'C', n: 3, form: 'a+(-b)' })[0]!;
    expect([o.form, o.bounced, o.target]).toEqual(['a-(-b)', true, -5]);
    expect(o.item).toEqual({ skillHint: 'int.addsub', a: -8, op: '-', b: -3, expected: -5 });
    const start = moveOptions(board, -10, { band: 'C', n: 1, form: 'a-b' })[0]!;
    expect([start.form, start.target]).toEqual(['a+b', -9]);
  });

  it('Band C: near the finish the move is shortened to land exactly on it', () => {
    const o = moveOptions(boardFor('C', 1), 12, { band: 'C', n: 7, form: 'a-(-b)' })[0]!;
    expect(o.item).toEqual({ skillHint: 'int.addsub', a: 12, op: '-', b: -3, expected: 15 });
    expect(o.capped).toBe(true);
  });

  it('the form die shows every form and moves forward 5 times in 6', () => {
    expect(new Set(FORM_DIE)).toEqual(new Set(['a+b', 'a-b', 'a+(-b)', 'a-(-b)']));
    const forward = FORM_DIE.filter((f) => f === 'a+b' || f === 'a-(-b)').length;
    expect(forward / FORM_DIE.length).toBeCloseTo(5 / 6);
  });

  it('every option is a well-formed item the generators can express', () => {
    const playable = new Set(SKILLS.filter((s) => s.gens?.length).map((s) => s.id));
    const rng = createRng(2024);
    for (const band of ['A', 'B', 'C'] as BandId[]) {
      for (let seed = 0; seed < 40; seed++) {
        const board = boardFor(band, seed);
        let lane = newLane(board);
        while (!isFinished(lane)) {
          const options = moveOptions(board, lane.position, roll(rng, band), ALL);
          expect(options.length).toBeGreaterThan(0);
          for (const o of options) {
            const { a, op, b, expected, skillHint } = o.item;
            expect(playable.has(skillHint), skillHint).toBe(true);
            expect(expected).toBe(op === '+' ? a + b : op === '-' ? a - b : a * b);
            expect(o.from).toBe(lane.position);
            expect(o.target).toBeGreaterThanOrEqual(board.floor);
            expect(o.target).toBeLessThanOrEqual(board.finish);
            if (band === 'A') expect([a >= 0, b >= 1, b <= 6, expected <= 20, o.target > o.from]).toEqual([true, true, true, true, true]);
            if (band === 'B') expect([a >= 1, a <= 6, b >= 1, b <= 6, o.target > o.from]).toEqual([true, true, true, true, true]);
            if (band === 'C') {
              expect(Math.abs(b)).toBeGreaterThanOrEqual(1);
              expect(Math.abs(b)).toBeLessThanOrEqual(10);
              expect(expected).toBe(o.target);
            }
          }
          lane = applyMove(lane, greedyPolicy(options)).lane;
        }
      }
    }
  });
});

describe('dice: wrong answers are never punished', () => {
  it('right, wrong, missing, slow and fast answers all move the token the same', () => {
    for (const band of ['A', 'B', 'C'] as BandId[]) {
      const board = boardFor(band, 9);
      const lane = newLane(board);
      const option = moveOptions(board, lane.position, roll(createRng(5), band), ALL)[0]!;
      const right = applyMove(lane, option, { given: option.item.expected, latencyMs: 1200 });
      const wrong = applyMove(lane, option, { given: option.item.expected + 1, latencyMs: 1200 });
      const slow = applyMove(lane, option, { given: option.item.expected - 3, latencyMs: 90_000 });
      const none = applyMove(lane, option);
      expect([right.correct, wrong.correct, slow.correct, none.correct]).toEqual([true, false, false, null]);
      for (const r of [wrong, slow, none]) {
        expect(r.lane).toEqual(right.lane);
        expect(r.notes).toEqual(right.notes);
      }
      expect(right.lane.position).toBe(option.target);
    }
  });

  it('a wrong Band A answer still hops the token forward by the dots', () => {
    const board = boardFor('A', 1);
    const [o] = moveOptions(board, 4, { band: 'A', dots: 5 });
    const r = applyMove(at(newLane(board), 4), o!, { given: 8 });
    expect(r.correct).toBe(false);
    expect(r.lane.position).toBe(9);
  });

  it('a whole race played with only wrong answers takes exactly as many turns', () => {
    for (const band of ['A', 'B', 'C'] as BandId[]) {
      const play = (answer: (o: MoveOption) => number | null): number[] => {
        const board = boardFor(band, 4);
        const rng = createRng(77);
        let lane = newLane(board);
        const path = [lane.position];
        while (!isFinished(lane)) {
          const o = greedyPolicy(moveOptions(board, lane.position, roll(rng, band), ALL));
          lane = applyMove(lane, o, { given: answer(o) }).lane;
          path.push(lane.position);
        }
        return path;
      };
      expect(play((o) => o.item.expected + 7)).toEqual(play((o) => o.item.expected));
    }
  });

  it('rejects moves that do not start from the token', () => {
    const board = boardFor('A', 1);
    const [o] = moveOptions(board, 3, { band: 'A', dots: 2 });
    expect(() => applyMove(newLane(board), o!)).toThrow();
  });
});

describe('dice determinism and matches', () => {
  it('roll is deterministic for a seed and covers every face', () => {
    const seq = (seed: number): DiceRoll[] => {
      const rng = createRng(seed);
      return Array.from({ length: 50 }, () => roll(rng, 'C'));
    };
    expect(seq(3)).toEqual(seq(3));
    expect(seq(3)).not.toEqual(seq(4));
    const rng = createRng(1);
    const dots = new Set(Array.from({ length: 300 }, () => (roll(rng, 'A') as { dots: number }).dots));
    expect([...dots].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  const playOut = (seed: number): MatchState => {
    let m = createMatch(
      [
        { id: 'ana', band: 'A', ops: [] },
        { id: 'marko', band: 'B', ops: ALL },
      ],
      seed,
    );
    for (let guard = 0; guard < 200 && !m.over; guard++) {
      m = rollDice(m);
      const choice = m.pending!.options.indexOf(greedyPolicy(m.pending!.options));
      m = playMove(m, choice, { given: null }).match;
    }
    return m;
  };

  it('a match replays identically from its seed', () => {
    expect(playOut(12)).toEqual(playOut(12));
    expect(JSON.parse(JSON.stringify(playOut(12)))).toEqual(playOut(12)); // plain JSON
  });

  it('rolling twice before moving does not re-roll', () => {
    const m = rollDice(createMatch([{ id: 'x', band: 'B', ops: ALL }], 1));
    expect(rollDice(m)).toBe(m);
  });

  it('everyone gets the same number of turns, and the match ends at the end of that round', () => {
    for (let seed = 0; seed < 50; seed++) {
      const m = playOut(seed);
      expect(m.over).toBe(true);
      const [a, b] = m.lanes;
      expect(a!.turns).toBe(b!.turns);
      expect(m.lanes.some(isFinished)).toBe(true);
      expect(() => playMove(rollDice(m), 0)).toThrow(); // no moves after the end
    }
  });

  it('the summary celebrates every player and ranks no one', () => {
    for (let seed = 0; seed < 30; seed++) {
      const summary = matchSummary(playOut(seed));
      expect(summary.map((s) => s.id)).toEqual(['ana', 'marko']);
      for (const s of summary) {
        expect([DICE_KEYS.resultPond, DICE_KEYS.resultJourney]).toContain(s.line.key);
        expect(s.line.key === DICE_KEYS.resultPond).toBe(s.arrived);
        expect(Object.keys(s).sort()).toEqual(['arrived', 'id', 'line']);
        expect(JSON.stringify(s)).not.toMatch(/win|lose|lost|rank|place|score/i);
      }
    }
  });

  it('dice message keys live in the dice block', () => {
    for (const key of Object.values(DICE_KEYS)) expect(key).toMatch(/^dice\./);
  });
});

// ── integration: real items on each child's own profile (src/modes/dice, src/app/diceActions) ──

describe('fixed items from operands (GeneratorDef.fromOperands)', () => {
  /** The operands a sampled item was built from, read back from its features. */
  const operandsOf = (genId: string, cfg: Record<string, unknown>, it: GeneratedItem): Operands => {
    const f = it.features;
    if (genId === 'intAddSub') {
      const form = ['a+b', 'a-b', 'a+(-b)', 'a-(-b)'][f.form!]!;
      return { a: f.a!, op: form.startsWith('a+') ? '+' : '-', b: form.includes('(-b)') ? -f.b! : f.b! };
    }
    if (genId === 'mult') return { a: f.a!, op: '*', b: f.b! };
    return { a: f.a!, op: cfg.op as '+' | '-', b: f.b! };
  };

  const bindings = GRAPH.playableSkills().flatMap((s) =>
    (s.gens ?? []).filter((b) => getGenerator(b.id).fromOperands).map((b) => ({ skill: s.id, id: b.id, cfg: (b.config ?? {}) as Record<string, unknown> })),
  );

  it('covers the dice generators: addsub, intAddSub and mult', () => {
    expect(new Set(bindings.map((b) => b.id))).toEqual(new Set(['addsub', 'intAddSub', 'mult']));
  });

  for (const b of bindings) {
    it(`${b.skill} via ${b.id}: the level is the sampler's scorer level, and the whole item matches`, () => {
      const gen = getGenerator(b.id);
      const rng = createRng(4242);
      for (let i = 0; i < 150; i++) {
        const sampled = gen.generate(rng.next(), rng, b.cfg);
        const fixed = gen.fromOperands!(operandsOf(b.id, b.cfg, sampled), b.cfg);
        expect(fixed, JSON.stringify(sampled.features)).not.toBeNull();
        expect(fixed!.level).toBe(sampled.level);
        expect(fixed).toEqual(sampled);
      }
    });
  }

  it('Band C operands past the sampler range are accepted (a up to 14; the line widens only when needed)', () => {
    const int = getGenerator('intAddSub');
    const top = int.fromOperands!({ a: 14, op: '-', b: -1 }, {})!;
    expect(toNumber(top.answer.value)).toBe(15);
    expect(top.prompt).toEqual({ kind: 'expr', expr: { k: 'op', op: '-', a: { k: 'num', v: 14 }, b: { k: 'num', v: -1 } } });
    expect([top.line.min, top.line.max, top.line.start]).toEqual([-20, 20, 14]);
    expect(top.level).toBeGreaterThan(0);
    const far = int.fromOperands!({ a: 18, op: '+', b: 7 }, {})!;
    expect(far.line.max).toBeGreaterThanOrEqual(25);
    for (let a = -10; a <= 14; a++) {
      for (const b of [-10, -3, -1, 1, 4, 10]) {
        for (const op of ['+', '-'] as const) {
          const it = int.fromOperands!({ a, op, b }, {})!;
          const r = toNumber(it.answer.value);
          expect(r).toBe(op === '+' ? a + b : a - b);
          expect(r).toBeGreaterThanOrEqual(it.line.min);
          expect(r).toBeLessThanOrEqual(it.line.max);
        }
      }
    }
  });

  it('refuses what a generator cannot express', () => {
    const add = getGenerator('addsub');
    expect(add.fromOperands!({ a: 3, op: '-', b: 2 }, { op: '+', range: 10 })).toBeNull();
    expect(add.fromOperands!({ a: 2, op: '-', b: 5 }, { op: '-', range: 10 })).toBeNull();
    expect(add.fromOperands!({ a: -2, op: '+', b: 5 }, { op: '+', range: 10 })).toBeNull();
    expect(getGenerator('mult').fromOperands!({ a: 3, op: '+', b: 4 }, {})).toBeNull();
    expect(getGenerator('intAddSub').fromOperands!({ a: 3, op: '*', b: 4 }, {})).toBeNull();
    expect(getGenerator('intAddSub').fromOperands!({ a: 3, op: '+', b: 0 }, {})).toBeNull();
    // Past the config's range: accepted, with a line that holds the answer.
    const wide = add.fromOperands!({ a: 17, op: '+', b: 3 }, { op: '+', range: 10 })!;
    expect([wide.line.max, toNumber(wide.answer.value)]).toEqual([20, 20]);
  });

  it('every move of every band becomes a real item with the move’s operands and answer', () => {
    const rng = createRng(77);
    for (const band of ['A', 'B', 'C'] as BandId[]) {
      for (let seed = 0; seed < 25; seed++) {
        const board = boardFor(band, seed);
        let lane = newLane(board);
        while (!isFinished(lane)) {
          const options = moveOptions(board, lane.position, roll(rng, band), ALL);
          for (const o of options) {
            const built = moveItem(o.item, {});
            expect(toNumber(built.generated.answer.value)).toBe(o.item.expected);
            const pr = built.generated.prompt;
            expect(pr.kind === 'expr' && pr.expr.k === 'op' && pr.expr.op).toBe(o.item.op);
            expect(GRAPH.get(built.skillId).gens!.some((g) => g.id === built.gen.id)).toBe(true);
          }
          lane = applyMove(lane, greedyPolicy(options)).lane;
        }
      }
    }
  });
});

describe('dice skill choice: ratings stay sensible', () => {
  const T0 = Date.UTC(2026, 8, 20, 15);
  const solid = (...ids: string[]): Record<string, SkillState> =>
    Object.fromEntries(ids.map((id) => [id, { ...glickoElo.init(GRAPH.get(id), T0), proficientAt: T0 }]));
  const sum = (a: number, b: number): DiceItemSpec => ({ skillHint: a + b <= 10 ? 'as.add.10' : 'as.add.20', a, op: '+', b, expected: a + b });

  it('an unlocked hint is used as is', () => {
    const states = solid('as.bonds.5', 'as.add.10', 'as.bonds.10', 'num.line.20', 'num.subitize.10');
    expect(moveSkill(sum(8, 5), states)).toBe('as.add.20');
    expect(moveSkill(sum(3, 4), states)).toBe('as.add.10');
  });

  it('a locked Band A hint falls back to the nearest unlocked add skill', () => {
    const states = solid('as.bonds.5'); // as.add.10 unlocked, as.add.20 not
    expect(moveSkill(sum(8, 5), states)).toBe('as.add.10');
    // Rated at that skill's own scorer level: a sum past 10 is simply a hard "within 10" item.
    const built = moveItem(sum(8, 5), states);
    expect(built.generated.level).toBe(getGenerator('addsub').fromOperands!({ a: 8, op: '+', b: 5 }, { op: '+', range: 10 })!.level);
    expect(built.generated.level).toBeGreaterThan(0.8);
  });

  it('with nothing unlocked it is the most basic playable skill of that kind', () => {
    expect(moveSkill(sum(8, 5), {})).toBe('as.add.10');
    expect(moveSkill({ skillHint: 'as.sub.10', a: 6, op: '-', b: 2, expected: 4 }, {})).toBe('as.sub.10');
    expect(moveSkill({ skillHint: 'md.mult.facts', a: 3, op: '*', b: 4, expected: 12 }, {})).toBe('md.mult.2510');
    // Integers have one skill of their kind: it is rated there even before it unlocks.
    expect(moveSkill({ skillHint: 'int.addsub', a: -3, op: '-', b: -4, expected: 1 }, {})).toBe('int.addsub');
  });

  it('Band B operators follow the child’s unlocked skills', () => {
    expect(opsForSkills({})).toEqual(['+']);
    expect(opsForSkills(solid('as.add.10'))).toEqual(['+', '-']);
    expect(opsForSkills(solid('as.add.10', 'md.mult.2510'))).toEqual(['+', '-', '*']);
  });
});

describe('pass-and-play: two children, one MemoryKV repo', () => {
  const T0 = Date.UTC(2026, 8, 21, 16);
  let ana: Profile;
  let marko: Profile;
  let stefan: Profile;

  const placed = (name: string, age: number, g: number): Profile => {
    const p = createProfile({ name, age, locale: 'mk', avatar: 'color.green' }, T0);
    const done: EventRecord = { type: 'event', ts: T0, sid: null, name: EVENTS.PLACEMENT_DONE, data: { g, sd: 0.3 } };
    return saveProfile({ ...p, skills: replay({ graph: GRAPH, model: glickoElo }, [done]), placement: { done: true, state: null, g, sd: 0.3 } });
  };
  const logOf = (pid: string): LogRecord[] => repo.readKnownLog(pid);
  const diceItems = (pid: string): ItemRecord[] => logOf(pid).filter((r): r is ItemRecord => r.type === 'item' && r.mode === 'dice');

  beforeAll(() => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    vi.stubGlobal('history', { pushState: vi.fn(), replaceState: vi.fn() });
    vi.stubGlobal('location', { hash: '' });
    repo.init();
    ana = placed('Ана', 6, 1.2);
    marko = placed('Марко', 9, 3.5);
    stefan = placed('Стефан', 13, 7.5);
    setState({ profile: ana, profiles: [ana, marko, stefan], session: null, meta: repo.meta() });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Play one whole turn: the pass screen, the roll, the operator (B: option `pick`), an answer from `answer`. */
  function playTurn(answer: (expected: number) => number, opts: { latencyMs?: number; pick?: number } = {}): { correct: boolean; from: number; to: number } {
    beginTurn();
    rollTurn();
    if (getDice().turn.choice === null) chooseOption((opts.pick ?? 0) % getDice().match!.pending!.options.length);
    const d = getDice();
    const player = d.turn.player;
    const band = d.match!.players[player]!.band;
    const from = d.match!.lanes[player]!.position;
    const v = answer(toNumber(d.turn.presented!.item.answer.value));
    const response: Response = band === 'A' ? { kind: 'landed', value: v, hops: Math.abs(v - from) } : { kind: 'typed', raw: v < 0 ? `−${-v}` : String(v) };
    const res = answerTurn(response, { latencyMs: opts.latencyMs ?? 2500, hint: false, input: band === 'A' ? 'hops' : 'typed', hops: 0 });
    const to = getDice().match!.lanes[player]!.position;
    endTurn();
    return { correct: !!res?.grade.correct, from, to };
  }

  function playMatch(pids: string[], seed: number, answer: (expected: number, i: number) => number, latencyMs?: number): MatchState {
    expect(startMatch(pids, seed)).toBe(true);
    let last: MatchState | null = null;
    for (let i = 0; i < 200 && getDice().match; i++) {
      playTurn((e) => answer(e, i), { ...(latencyMs === undefined ? {} : { latencyMs }), pick: i });
      last = getDice().match ?? last;
    }
    expect(getDice().phase).toBe('results');
    return last!;
  }

  it('each child’s answers land only in their own log, on their own profile', () => {
    const before = { [ana.id]: logOf(ana.id).length, [marko.id]: logOf(marko.id).length };
    const itemsBefore = { [ana.id]: repo.loadProfile(ana.id)!.stats.items, [marko.id]: repo.loadProfile(marko.id)!.stats.items };
    // Some answers right, some wrong.
    playMatch([marko.id, ana.id], 31, (e, i) => (i % 3 === 1 ? e + 1 : e));
    const results = getDice().results!;
    expect(results.map((r) => r.pid)).toEqual([marko.id, ana.id]);

    for (const [pid, other] of [[ana.id, marko.id], [marko.id, ana.id]] as const) {
      const log = logOf(pid).slice(before[pid]);
      const sessions = log.filter((r): r is SessionRecord => r.type === 'session');
      expect(sessions.map((r) => [r.phase, r.mode])).toEqual([['start', 'dice'], ['end', 'dice']]);
      const sid = sessions[0]!.sid;
      const items = log.filter((r): r is ItemRecord => r.type === 'item');
      const turns = results.find((r) => r.pid === pid)!.result.firstAttempts;
      expect(items.length).toBe(turns);
      expect(turns).toBeGreaterThan(2);
      expect(items.every((r) => r.sid === sid && r.mode === 'dice' && r.source === 'fixed' && r.attempt === 1)).toBe(true);
      expect(items.every((r) => r.band === repo.loadProfile(pid)!.band)).toBe(true);
      // Nothing of the other child's session is in this log.
      const otherSid = logOf(other).filter((r): r is SessionRecord => r.type === 'session' && r.mode === 'dice').at(-1)!.sid;
      expect(log.some((r) => r.sid === otherSid)).toBe(false);
      // One match event per child: lane facts only, never a winner, place or score.
      const ev = log.filter((r): r is EventRecord => r.type === 'event' && r.name === EVENTS.DICE_MATCH);
      expect(ev).toHaveLength(1);
      expect(ev[0]!.sid).toBe(sid);
      expect(ev[0]!.data!.turns).toBe(turns);
      expect(JSON.stringify(ev[0]!.data)).not.toMatch(/win|lose|lost|rank|place|score/i);
      expect(repo.loadProfile(pid)!.stats.items).toBe(itemsBefore[pid]! + turns);
    }
    // Both children took the same number of turns (the race ends with the round).
    expect(results[0]!.result.firstAttempts).toBe(results[1]!.result.firstAttempts);
    // The app's active child and session were never touched.
    expect(getState().profile?.id).toBe(ana.id);
    expect(getState().session).toBeNull();
    // Band A items are rated on unlocked (or the most basic) add skills, never a locked hint.
    expect(new Set(diceItems(ana.id).map((r) => r.skill))).toEqual(new Set(['as.add.10']));
    expect(diceItems(marko.id).every((r) => ['as.add.10', 'as.add.20', 'as.sub.10'].includes(r.skill))).toBe(true);
  });

  it('a wrong Band A answer still moves the token, exactly as far as a right one', () => {
    const first = (answer: (e: number) => number): { correct: boolean; from: number; to: number } => {
      startMatch([ana.id, marko.id], 5);
      const turn = playTurn(answer);
      quitMatch();
      return turn;
    };
    const right = first((e) => e);
    const wrong = first((e) => e + 1);
    expect([right.correct, wrong.correct]).toEqual([true, false]);
    expect(wrong.to).toBe(right.to);
    expect(wrong.to).toBeGreaterThan(wrong.from);
    // A whole race answered wrong every time travels exactly the same path.
    const allWrong = playMatch([ana.id, marko.id], 9, (e) => e + 1);
    const allRight = playMatch([ana.id, marko.id], 9, (e) => e);
    expect(allWrong).toEqual(allRight);
  });

  it('Band C integer forms work end to end (negative answers typed with −)', () => {
    const n = diceItems(stefan.id).length;
    playMatch([stefan.id, ana.id], 12, (e) => e);
    const items = diceItems(stefan.id).slice(n);
    expect(items.length).toBeGreaterThan(2);
    expect(items.every((r) => r.skill === 'int.addsub' && r.correct && r.gen === 'intAddSub')).toBe(true);
  });

  it('nothing depends on latency: the race and the ratings are the same fast or slow', () => {
    const run = (latencyMs: number): { match: MatchState; ana: Record<string, SkillState>; marko: Record<string, SkillState> } => {
      saveProfile(ana);
      saveProfile(marko);
      const match = playMatch([ana.id, marko.id], 21, (e, i) => (i % 2 ? e : e + 2), latencyMs);
      return { match, ana: repo.loadProfile(ana.id)!.skills, marko: repo.loadProfile(marko.id)!.skills };
    };
    const fast = run(40);
    const slow = run(120_000);
    expect(slow.match).toEqual(fast.match);
    for (const who of ['ana', 'marko'] as const) {
      for (const [id, st] of Object.entries(fast[who])) {
        expect(slow[who][id]!.mu, `${who} ${id}`).toBeCloseTo(st.mu, 9);
        expect(slow[who][id]!.s2, `${who} ${id}`).toBeCloseTo(st.s2, 9);
      }
    }
  });
});
