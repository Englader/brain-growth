import { describe, expect, it } from 'vitest';
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
