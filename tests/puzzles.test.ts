import { describe, expect, it } from 'vitest';
import { recentLog, saveProfile, updateQuests } from '../src/app/persist';
import { beginPuzzle, completePuzzle, endPuzzleSession, startPuzzleSession } from '../src/app/puzzleActions';
import { now, repo } from '../src/app/services';
import { setState } from '../src/app/store';
import { ACHIEVEMENTS, evaluateAchievements, validateAchievements, type EvalContext } from '../src/core/achievements';
import { levelToDifficulty } from '../src/core/engine/glicko';
import { EVENTS, type LogRecord, type SessionRecord } from '../src/core/log/types';
import { createProfile, type Profile } from '../src/core/profile';
import { questsForDay } from '../src/core/quests';
import { GRAPH } from '../src/core/skills';
import { dayKey } from '../src/core/time';
import { mergeProfiles } from '../src/data/merge';
import { getLocale } from '../src/i18n/locales';
import { parsePuzzleEvent, PUZZLE_VIOLATION_KEYS, type PuzzleRating } from '../src/puzzles';
import { PUZZLE_PRIORS } from '../src/puzzles/rating';
import { cmp, fromNumber, rat, toNumber } from '../src/core/rational';
import { createRng } from '../src/core/rng';
import { DAY_MS } from '../src/core/time';
import type { BandId } from '../src/core/types';
import {
  allPuzzleTypes,
  applyPuzzleResult,
  estimateTruth,
  finishPuzzle,
  getPuzzleType,
  initPuzzleRating,
  predictPuzzle,
  PUZZLE_EVENT,
  PUZZLE_HINT_KEYS,
  PUZZLE_TARGET,
  PUZZLE_TYPE_KEYS,
  puzzleEventsFromLog,
  puzzleLevelFor,
  puzzleTypesFor,
  puzzleY,
  rebuildPuzzle,
  registerPuzzleType,
  replayPuzzleRatings,
  startPuzzle,
  violationKey,
  type AnyPuzzleType,
  type BalanceAnswer,
  type BalancePuzzle,
  type CryptAnswer,
  type CryptPuzzle,
  type EstimateAnswer,
  type EstimatePuzzle,
  type LogicAnswer,
  type LogicPuzzle,
  type PatternPuzzle,
  type PuzzleEvent,
  type PuzzleRatings,
  type StartedPuzzle,
} from '../src/puzzles';
import { allAssignments, balances, coefficientRank, derivation } from '../src/puzzles/types/balance';
import { cryptPuzzle, cryptSolutions } from '../src/puzzles/types/crypt';
import { estimatePuzzle } from '../src/puzzles/types/estimate';
import { eliminate, logicPuzzle, logicSolutions } from '../src/puzzles/types/logic';
import { patternPuzzle, patternRivals, predictNext } from '../src/puzzles/types/pattern';
import { balancePuzzle } from '../src/puzzles/types/balance';

const T0 = Date.UTC(2026, 8, 1, 12);
const SEEDS = Array.from({ length: 24 }, (_, i) => i * 7919 + 13);
const LEVELS = [0, 0.25, 0.5, 0.75, 1];

/** Every (type, band) pair the registry offers. */
const PAIRS: Array<[AnyPuzzleType, BandId]> = allPuzzleTypes().flatMap((t) => t.bands.map((b): [AnyPuzzleType, BandId] => [t, b]));

function gen<P>(def: AnyPuzzleType, band: BandId, level: number, seed: number): { puzzle: P; achievedLevel: number; features: Record<string, number> } {
  return def.generate(createRng(seed), band, level);
}

/** A sample of generated puzzles across levels and seeds. */
function sample<P>(def: AnyPuzzleType, band: BandId, seeds = SEEDS.slice(0, 12)): P[] {
  return LEVELS.flatMap((lv) => seeds.map((s) => gen<P>(def, band, lv, s).puzzle));
}

/** The primary difficulty feature per (type, band): its mean must not fall as the level rises. */
const PRIMARY: Record<string, string> = {
  'pattern:A': 'rank',
  'pattern:B': 'rank',
  'pattern:C': 'rank',
  'balance:A': 'rank',
  'balance:B': 'work',
  'balance:C': 'work',
  'estimate:B': 'tight',
  'estimate:C': 'tight',
  'crypt:C': 'unknowns',
  'logic:B': 'clues',
  'logic:C': 'clues',
};

describe('puzzle registry', () => {
  it('offers types per band in shelf order', () => {
    expect(puzzleTypesFor('A').map((t) => t.id)).toEqual(['pattern', 'balance']);
    expect(puzzleTypesFor('B').map((t) => t.id)).toEqual(['pattern', 'balance', 'estimate', 'logic']);
    expect(puzzleTypesFor('C').map((t) => t.id)).toEqual(['pattern', 'balance', 'estimate', 'logic', 'crypt']);
  });

  it('rejects duplicates, unknown ids and unsupported bands', () => {
    expect(() => registerPuzzleType(patternPuzzle)).toThrow(/twice/);
    expect(() => getPuzzleType('nope')).toThrow(/unknown/);
    expect(() => estimatePuzzle.generate(createRng(1), 'A', 0.5)).toThrow(RangeError);
    expect(() => cryptPuzzle.generate(createRng(1), 'B', 0.5)).toThrow(RangeError);
    expect(() => logicPuzzle.generate(createRng(1), 'A', 0.5)).toThrow(RangeError);
  });

  it('every type has a shelf title key and a version', () => {
    for (const t of allPuzzleTypes()) {
      expect(PUZZLE_TYPE_KEYS[t.id as keyof typeof PUZZLE_TYPE_KEYS]).toBe(`puzzle.type.${t.id}`);
      expect(t.version).toBeGreaterThanOrEqual(1);
    }
  });
});

describe.each(PAIRS.map(([t, b]) => [`${t.id}:${b}`, t, b] as const))('%s', (_name, def, band) => {
  it('is deterministic and plain JSON', () => {
    for (const lv of LEVELS) {
      for (const s of SEEDS.slice(0, 6)) {
        const a = gen(def, band, lv, s);
        const b = gen(def, band, lv, s);
        expect(b).toEqual(a);
        expect(JSON.parse(JSON.stringify(a))).toEqual(a);
        expect(a.achievedLevel).toBeGreaterThanOrEqual(0);
        expect(a.achievedLevel).toBeLessThanOrEqual(1);
      }
    }
  });

  it('achieved level and the primary feature rise with the requested level', () => {
    const means = [0.1, 0.5, 0.9].map((lv) => {
      const gs = SEEDS.map((s) => gen(def, band, lv, s));
      return {
        level: gs.reduce((a, g) => a + g.achievedLevel, 0) / gs.length,
        feature: gs.reduce((a, g) => a + g.features[PRIMARY[`${def.id}:${band}`]!]!, 0) / gs.length,
      };
    });
    expect(means[1]!.level).toBeGreaterThan(means[0]!.level + 0.1);
    expect(means[2]!.level).toBeGreaterThan(means[1]!.level + 0.05);
    expect(means[1]!.feature).toBeGreaterThanOrEqual(means[0]!.feature);
    expect(means[2]!.feature).toBeGreaterThanOrEqual(means[1]!.feature);
    expect(means[2]!.feature).toBeGreaterThan(means[0]!.feature);
    // Mid-range requests are met closely.
    expect(Math.abs(means[1]!.level - 0.5)).toBeLessThan(0.06);
  });

  it('the solver finds a solution and the checker accepts every one it returns', () => {
    for (const p of sample(def, band)) {
      const sols = def.solve(p);
      expect(sols.length).toBeGreaterThanOrEqual(1);
      for (const a of sols) expect(def.check(p, a)).toEqual({ ok: true });
    }
  });

  it('has a hint ladder that starts at tier 1, ends, and uses listed keys only', () => {
    for (const p of sample(def, band, SEEDS.slice(0, 4))) {
      const first = def.hint(p, 1);
      expect(first).not.toBeNull();
      let tier = 1;
      for (let h = def.hint(p, tier); h; h = def.hint(p, ++tier)) {
        expect(PUZZLE_HINT_KEYS).toContain(h.key);
        expect(h.key.startsWith(`puzzle.hint.${def.id}.`)).toBe(true);
        for (const v of Object.values(h.params)) expect(['number', 'string']).toContain(typeof v);
      }
      expect(tier).toBeLessThanOrEqual(4);
    }
  });
});

describe('pattern', () => {
  const puzzles = (['A', 'B', 'C'] as const).flatMap((b) => sample<PatternPuzzle>(patternPuzzle, b, SEEDS));

  it('is unambiguous: no simpler or equal rule fits the shown terms with another next term', () => {
    for (const p of puzzles) {
      expect(patternRivals(p)).toEqual([]);
      expect(patternPuzzle.solve(p)).toHaveLength(1);
    }
  });

  it('detects an ambiguous sequence (the generator would reject it)', () => {
    // 2, 3, 5, 8: Fibonacci-like says 13, but constant second difference (simpler) says 12.
    const p: PatternPuzzle = { kind: 'numbers', family: 'fib', seq: [2, 3, 5, 8] };
    expect(patternRivals(p)).toEqual(['second']);
    expect(patternPuzzle.solve(p)).toEqual([12]);
    // One more term settles it.
    expect(patternRivals({ ...p, seq: [2, 3, 5, 8, 13] })).toEqual([]);
  });

  it('Band A is pictures only: tile ids, palette of tiles used, at least two cycles shown', () => {
    for (const p of sample<PatternPuzzle>(patternPuzzle, 'A', SEEDS)) {
      expect(p.kind).toBe('tiles');
      if (p.kind !== 'tiles') continue;
      expect(new Set(p.palette)).toEqual(new Set(p.seq));
      expect(p.seq.length).toBeLessThanOrEqual(10);
      expect(p.palette).toContain(patternPuzzle.solve(p)[0]);
    }
  });

  it('Bands B/C are integer sequences the family itself predicts; Band B stays within 0–1000', () => {
    for (const b of ['B', 'C'] as const) {
      for (const p of sample<PatternPuzzle>(patternPuzzle, b, SEEDS)) {
        expect(p.kind).toBe('numbers');
        if (p.kind !== 'numbers') continue;
        const next = predictNext(p.family, p.seq);
        expect(next && next.d).toBe(1);
        expect(patternPuzzle.solve(p)).toEqual([toNumber(next!)]);
        if (b === 'B') for (const x of [...p.seq, toNumber(next!)]) expect(x >= 0 && x <= 1000).toBe(true);
        if (b === 'B') expect(p.family).not.toBe('fib');
      }
    }
  });

  it('rejects a wrong next term and reports the `next` constraint', () => {
    for (const p of puzzles.slice(0, 120)) {
      const right = patternPuzzle.solve(p)[0]!;
      const wrong = p.kind === 'tiles' ? p.palette.find((t) => t !== right)! : (right as number) + 1;
      expect(patternPuzzle.check(p, wrong)).toEqual({ ok: false, violated: ['next'] });
      // Wrong answer shape is rejected the same way.
      expect(patternPuzzle.check(p, p.kind === 'tiles' ? 3 : 't0').ok).toBe(false);
    }
  });
});

describe('balance', () => {
  const byBand = (b: BandId): BalancePuzzle[] => sample<BalancePuzzle>(balancePuzzle, b, SEEDS);

  it('has exactly one solution, found by brute force over the whole weight range', () => {
    for (const b of ['A', 'B', 'C'] as const) {
      for (const p of byBand(b)) {
        expect(allAssignments(p)).toHaveLength(1);
        expect(balancePuzzle.solve(p)).toHaveLength(1);
        expect(coefficientRank(p)).toBe(p.shapes.length);
      }
    }
  });

  it('is solvable a step at a time: single scales, or two scales compared', () => {
    for (const b of ['A', 'B', 'C'] as const) {
      for (const p of byBand(b)) expect(new Set(derivation(p).map((s) => s.shape))).toEqual(new Set(p.shapes));
    }
  });

  it('Band A asks one shape, answer 0–10, at most 10 cubes per pan; B/C ask every shape', () => {
    for (const p of byBand('A')) {
      expect(p.ask).toHaveLength(1);
      expect(p.max).toBe(10);
      const [sol] = balancePuzzle.solve(p);
      expect(sol![p.ask[0]!]).toBeGreaterThanOrEqual(0);
      expect(sol![p.ask[0]!]).toBeLessThanOrEqual(10);
      for (const sc of p.scales) expect(Math.max(sc.left.units, sc.right.units)).toBeLessThanOrEqual(10);
    }
    for (const b of ['B', 'C'] as const) {
      for (const p of byBand(b)) {
        expect(p.ask).toEqual(p.shapes);
        expect(p.scales.length).toBeGreaterThanOrEqual(2);
        expect(p.scales.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('rejects wrong weights and names exactly the scales that tip', () => {
    for (const b of ['A', 'B', 'C'] as const) {
      for (const p of byBand(b).slice(0, 40)) {
        const [sol] = balancePuzzle.solve(p);
        const s = p.ask[0]!;
        const wrong: BalanceAnswer = { ...sol!, [s]: sol![s]! === p.max ? p.max - 1 : sol![s]! + 1 };
        const r = balancePuzzle.check(p, wrong);
        expect(r.ok).toBe(false);
        const full = { ...allAssignments(p)[0]!, ...wrong };
        const tipped = p.scales.map((sc, i) => (balances(sc, full) ? null : `scale:${i}`)).filter(Boolean);
        expect(r.violated).toEqual(tipped);
        expect(tipped.length).toBeGreaterThan(0);
      }
    }
  });

  it('reports a missing or out-of-range weight against its shape', () => {
    const p = byBand('B')[5]!;
    const [sol] = balancePuzzle.solve(p);
    const s = p.ask[1]!;
    const missing = { ...sol! };
    delete missing[s];
    expect(balancePuzzle.check(p, missing)).toEqual({ ok: false, violated: [`shape:${s}`] });
    expect(balancePuzzle.check(p, { ...sol!, [s]: p.max + 1 })).toEqual({ ok: false, violated: [`shape:${s}`] });
    expect(balancePuzzle.check(p, { ...sol!, [s]: 2.5 })).toEqual({ ok: false, violated: [`shape:${s}`] });
  });

  it('hints never give away the last unknown weight', () => {
    for (const p of [...byBand('A'), ...byBand('C')].slice(0, 200)) {
      const revealed = new Set<string>();
      for (let t = 1, h = balancePuzzle.hint(p, t); h; h = balancePuzzle.hint(p, ++t)) {
        if (h.key === 'puzzle.hint.balance.known') revealed.add(String(h.params.shape));
      }
      expect(revealed.size).toBeLessThan(p.shapes.length);
      for (const s of p.ask) if (p.ask.length === 1) expect(revealed.has(s)).toBe(false);
    }
  });
});

describe('estimate', () => {
  const puzzles = (['B', 'C'] as const).flatMap((b) => sample<EstimatePuzzle>(estimatePuzzle, b, SEEDS));

  it('the truth lies inside the widest allowed range, on the ruler and on the snap grid', () => {
    for (const p of puzzles) {
      const t = estimateTruth(p.q);
      const { min, max, snap } = p.ruler;
      expect(p.maxWidth % snap).toBe(0);
      expect(max % snap).toBe(0);
      expect(cmp(t, rat(max - p.maxWidth))).toBeLessThanOrEqual(0);
      const widest = estimatePuzzle.solve(p).find(([lo, hi]) => hi - lo === p.maxWidth)!;
      expect(widest).toBeDefined();
      const [lo, hi] = widest;
      expect(lo % snap).toBe(0);
      expect(lo).toBeGreaterThanOrEqual(min);
      expect(hi).toBeLessThanOrEqual(max);
      expect(cmp(fromNumber(lo), t)).toBeLessThanOrEqual(0);
      expect(cmp(fromNumber(hi), t)).toBeGreaterThanOrEqual(0);
      expect(estimatePuzzle.check(p, widest)).toEqual({ ok: true });
      expect(estimatePuzzle.check(p, [hi, lo])).toEqual({ ok: true }); // handles in either order
    }
  });

  it('reports too wide, below and above', () => {
    for (const p of puzzles.slice(0, 80)) {
      const t = toNumber(estimateTruth(p.q));
      const w = p.maxWidth;
      expect(estimatePuzzle.check(p, [Math.floor(t) - w, Math.ceil(t) + w])).toEqual({ ok: false, violated: ['wide'] });
      expect(estimatePuzzle.check(p, [t - 2 * w, t - w])).toEqual({ ok: false, violated: ['below'] });
      expect(estimatePuzzle.check(p, [t + 1, t + 1 + w])).toEqual({ ok: false, violated: ['above'] });
      expect(estimatePuzzle.check(p, [t - 3 * w, t - w])).toEqual({ ok: false, violated: ['wide', 'below'] });
      expect(estimatePuzzle.check(p, [Number.NaN, 3] as EstimateAnswer)).toEqual({ ok: false, violated: ['answer'] });
    }
  });

  it('a single-point range on an exact truth is a hit (width 0)', () => {
    const p: EstimatePuzzle = { q: { kind: 'product', a: 38, b: 21 }, maxWidth: 100, ruler: { min: 0, max: 1500, major: 500, snap: 10 } };
    expect(estimatePuzzle.check(p, [798, 798])).toEqual({ ok: true });
    expect(estimatePuzzle.check(p, [750, 850])).toEqual({ ok: true });
    expect(estimatePuzzle.check(p, [700, 790])).toEqual({ ok: false, violated: ['below'] });
  });

  it('percent truths are exact rationals', () => {
    const t = estimateTruth({ kind: 'percent', pct: 15, of: 342 });
    expect(t).toEqual(rat(513, 10));
  });
});

describe('crypt', () => {
  const puzzles = sample<CryptPuzzle>(cryptPuzzle, 'C', SEEDS);

  const leading = (p: CryptPuzzle): string[] => [...p.addends, p.sum].map((w) => w[0]!);

  it('generated puzzles have a unique solution with distinct digits and no leading zeros', () => {
    for (const p of puzzles) {
      const sols = cryptSolutions(p, 10);
      expect(sols).toHaveLength(1);
      const a = sols[0]!;
      expect(new Set(p.symbols.map((s) => a[s])).size).toBe(p.symbols.length);
      for (const s of leading(p)) expect(a[s]).not.toBe(0);
      for (const [s, d] of Object.entries(p.given)) expect(a[s]).toBe(d);
      // The assignment really adds up.
      const num = (w: string[]): number => Number(w.map((s) => a[s]).join(''));
      expect(p.addends.reduce((t, w) => t + num(w), 0)).toBe(num(p.sum));
      expect(p.symbols.length - Object.keys(p.given).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('accepts ANY valid assignment: AB + BA = CDC has six', () => {
    const p: CryptPuzzle = { addends: [['s0', 's1'], ['s1', 's0']], sum: ['s2', 's3', 's2'], symbols: ['s0', 's1', 's2', 's3'], given: {} };
    const sols = cryptPuzzle.solve(p);
    expect(sols).toHaveLength(6);
    for (const a of sols) {
      expect(cryptPuzzle.check(p, a)).toEqual({ ok: true });
      expect(a.s2).toBe(1);
      expect(a.s3).toBe(2);
      expect(a.s0! + a.s1!).toBe(11);
    }
  });

  it('reports distinct, leading-zero, missing and column violations', () => {
    const p: CryptPuzzle = { addends: [['s0', 's1'], ['s1', 's0']], sum: ['s2', 's3', 's2'], symbols: ['s0', 's1', 's2', 's3'], given: {} };
    const good: CryptAnswer = { s0: 3, s1: 8, s2: 1, s3: 2 };
    expect(cryptPuzzle.check(p, good).ok).toBe(true);
    expect(cryptPuzzle.check(p, { ...good, s3: 1 }).violated).toEqual(['distinct:s2', 'distinct:s3', 'col:1']);
    expect(cryptPuzzle.check(p, { s0: 0, s1: 1, s2: 2, s3: 3 }).violated).toContain('lead:s0');
    expect(cryptPuzzle.check(p, { s0: 3, s1: 8, s2: 1 }).violated).toEqual(['missing:s3']);
    // 34 + 43 = 77, not CDC: the hundreds column (a carry of 0) and the units column fail.
    expect(cryptPuzzle.check(p, { s0: 3, s1: 4, s2: 1, s3: 7 }).violated).toEqual(['col:0', 'col:2']);
  });

  it('given digits are fixed: the answer cannot override them', () => {
    for (const p of puzzles.filter((q) => Object.keys(q.given).length > 0).slice(0, 20)) {
      const [sol] = cryptPuzzle.solve(p);
      const [s, d] = Object.entries(p.given)[0]!;
      expect(cryptPuzzle.check(p, { ...sol!, [s]: (d + 1) % 10 }).ok).toBe(true);
      const withoutGiven = { ...sol! };
      delete withoutGiven[s];
      expect(cryptPuzzle.check(p, withoutGiven).ok).toBe(true);
    }
  });

  it('rejects a wrong assignment of generated puzzles', () => {
    for (const p of puzzles.slice(0, 60)) {
      const [sol] = cryptPuzzle.solve(p);
      const open = p.symbols.filter((s) => !(s in p.given));
      const s = open[0]!;
      const r = cryptPuzzle.check(p, { ...sol!, [s]: (sol![s]! + 1) % 10 });
      expect(r.ok).toBe(false);
      expect(r.violated!.length).toBeGreaterThan(0);
    }
  });
});

describe('logic', () => {
  const puzzles = (['B', 'C'] as const).flatMap((b) => sample<LogicPuzzle>(logicPuzzle, b, SEEDS));

  it('is solvable by elimination alone, so the solution is unique, with a minimal clue set', () => {
    for (const p of puzzles) {
      expect(eliminate(p)).not.toBeNull();
      expect(logicSolutions(p)).toHaveLength(1);
      expect(p.clues.length).toBeLessThanOrEqual(8);
      for (let i = 0; i < p.clues.length; i++) {
        expect(eliminate({ ...p, clues: p.clues.filter((_, j) => j !== i) })).toBeNull();
      }
    }
  });

  it('uses 3–4 items per category, 2–3 categories, and clues only between different categories', () => {
    for (const p of puzzles) {
      const n = p.categories[0]!.length;
      expect([3, 4]).toContain(n);
      expect([2, 3]).toContain(p.categories.length);
      for (const c of p.categories) expect(c).toHaveLength(n);
      for (const c of p.clues) expect(c.a[0]).not.toBe(c.b[0]);
    }
  });

  it('reports broken clues, missing items and doubled anchors', () => {
    for (const p of puzzles.slice(0, 60)) {
      const [sol] = logicPuzzle.solve(p);
      const cat = p.categories[1]!;
      // Swap the anchors of two items of one category: still one-to-one, so only clues can break.
      const swapped: LogicAnswer = { ...sol!, [cat[0]!]: sol![cat[1]!]!, [cat[1]!]: sol![cat[0]!]! };
      const r = logicPuzzle.check(p, swapped);
      expect(r.ok).toBe(false);
      for (const v of r.violated!) expect(v).toMatch(/^clue:\d+$/);
      const missing = { ...sol! };
      delete missing[cat[2]!];
      expect(logicPuzzle.check(p, missing).violated).toContain(`missing:${cat[2]!}`);
      const doubled: LogicAnswer = { ...sol!, [cat[0]!]: sol![cat[1]!]! };
      expect(logicPuzzle.check(p, doubled).violated).toContain(`twice:${sol![cat[1]!]!}:1`);
    }
  });
});

describe('puzzle outcome and rating', () => {
  it('scores y from hints and wrong checks; a reveal is 0', () => {
    expect(puzzleY({ solved: true, hints: 0, wrongChecks: 0 })).toBe(1);
    expect(puzzleY({ solved: true, hints: 1, wrongChecks: 2 })).toBe(0.55);
    expect(puzzleY({ solved: true, hints: 0, wrongChecks: 9 })).toBe(0.7);
    expect(puzzleY({ solved: true, hints: 4, wrongChecks: 0 })).toBe(0);
    expect(puzzleY({ solved: true, hints: 3, wrongChecks: 3 })).toBe(0);
    expect(puzzleY({ solved: false, hints: 0, wrongChecks: 0 })).toBe(0);
  });

  it('uses the engine mapping and moves like the engine', () => {
    const r = initPuzzleRating(T0);
    const lv = 0.3;
    const up = applyPuzzleResult({}, 'pattern', { y: 1, diff: levelToDifficulty(lv), ts: T0, solved: true }).pattern!;
    const down = applyPuzzleResult({}, 'pattern', { y: 0, diff: levelToDifficulty(lv), ts: T0, solved: false }).pattern!;
    expect(up.mu).toBeGreaterThan(r.mu);
    expect(down.mu).toBeLessThan(r.mu);
    expect(up.s2).toBeLessThan(r.s2);
    expect(up.n).toBe(1);
    expect(up.solved).toBe(1);
    expect(down.solved).toBe(0);
  });

  it('selects a level whose prediction is the target; "Harder one" asks for a harder level', () => {
    const r = { ...initPuzzleRating(T0), mu: 0.4, s2: 0.5, n: 10 };
    const normal = puzzleLevelFor(r, PUZZLE_TARGET.NORMAL, T0);
    const harder = puzzleLevelFor(r, PUZZLE_TARGET.HARDER, T0);
    expect(harder).toBeGreaterThan(normal);
    expect(predictPuzzle(r, normal, T0)).toBeCloseTo(0.75, 6);
    expect(predictPuzzle(r, harder, T0)).toBeCloseTo(0.55, 6);
    // A fresh type starts gently.
    expect(puzzleLevelFor(undefined, PUZZLE_TARGET.NORMAL, T0)).toBeLessThan(0.2);
  });

  it('startPuzzle is deterministic and the puzzle rebuilds from its logged provenance', () => {
    const r = { ...initPuzzleRating(T0), mu: 0.2, s2: 0.6, n: 5 };
    for (const def of allPuzzleTypes()) {
      const band = def.bands[def.bands.length - 1]!;
      const a = startPuzzle(def, band, r, PUZZLE_TARGET.NORMAL, T0, 12345);
      expect(startPuzzle(def, band, r, PUZZLE_TARGET.NORMAL, T0, 12345)).toEqual(a);
      expect(rebuildPuzzle(def, band, a.seed, a.req)).toEqual(a.puzzle);
      expect(a.diff).toBeCloseTo(-2.5 + 5 * a.level, 12);
      expect(a.p).toBeCloseTo(predictPuzzle(r, a.level, T0), 12);
    }
  });
});

/** A deterministic pretend child: solves when a coin says so, using some hints and wrong checks. */
function playSession(seed: number, days: number): { ratings: PuzzleRatings; events: PuzzleEvent[] } {
  const rng = createRng(seed);
  let ratings: PuzzleRatings = {};
  const events: PuzzleEvent[] = [];
  const band: BandId = 'C';
  let now = T0;
  for (let d = 0; d < days; d++) {
    now = T0 + d * DAY_MS + rng.int(0, 8) * 3_600_000;
    for (let k = 0; k < 6; k++) {
      const def = rng.pick(puzzleTypesFor(band));
      const target = rng.chance(0.2) ? PUZZLE_TARGET.HARDER : PUZZLE_TARGET.NORMAL;
      const started: StartedPuzzle<unknown> = startPuzzle(def, band, ratings[def.id], target, now, rng.int(1, 2 ** 30));
      const solved = rng.chance(started.p);
      const outcome = { solved, hints: rng.int(0, 2), wrongChecks: rng.int(0, 4), ms: rng.int(5_000, 900_000) };
      const res = finishPuzzle(ratings, started, outcome, 'mk');
      ratings = res.ratings;
      events.push(res.event);
      now += outcome.ms;
    }
  }
  return { ratings, events };
}

describe('puzzle replay', () => {
  it('rebuilds every per-type rating exactly from the logged events', () => {
    const { ratings, events } = playSession(7, 12);
    expect(Object.keys(ratings).sort()).toEqual(['balance', 'crypt', 'estimate', 'logic', 'pattern']);
    const logged = JSON.parse(JSON.stringify(events)) as unknown[];
    expect(replayPuzzleRatings(logged)).toEqual(ratings);
    // Order of the stored records does not matter.
    expect(replayPuzzleRatings(createRng(3).shuffle(logged))).toEqual(ratings);
  });

  it('reads puzzle events out of a session log', () => {
    const { ratings, events } = playSession(11, 4);
    const records: LogRecord[] = events.flatMap((e, i): LogRecord[] => [
      { type: 'event', ts: e.ts + 60_000, sid: `s${i}`, name: PUZZLE_EVENT, data: { ...e } },
      { type: 'event', ts: e.ts + 61_000, sid: `s${i}`, name: 'app_open', data: { band: 'C' } },
    ]);
    records.push({ type: 'event', ts: T0, sid: null, name: PUZZLE_EVENT, data: { type: 'pattern' } }); // malformed: skipped
    const parsed = puzzleEventsFromLog(records);
    expect(parsed).toHaveLength(events.length);
    expect(replayPuzzleRatings(parsed)).toEqual(ratings);
  });

  it('keeps ratings independent per type', () => {
    const { ratings, events } = playSession(5, 8);
    for (const type of Object.keys(ratings)) {
      const only = replayPuzzleRatings(events.filter((e) => e.type === type));
      expect(only[type]).toEqual(ratings[type]);
      expect(Object.keys(only)).toEqual([type]);
    }
    // Playing more of one type leaves the others untouched.
    const more = applyPuzzleResult(ratings, 'pattern', { y: 1, diff: 0, ts: T0 + 30 * DAY_MS, solved: true });
    for (const type of Object.keys(ratings)) if (type !== 'pattern') expect(more[type]).toBe(ratings[type]);
    expect(more.pattern).not.toEqual(ratings.pattern);
  });

  it('latency has no effect on ratings', () => {
    const def = getPuzzleType('balance');
    const started = startPuzzle(def, 'B', undefined, PUZZLE_TARGET.NORMAL, T0, 99);
    const fast = finishPuzzle({}, started, { solved: true, hints: 1, wrongChecks: 1, ms: 4_000 }, 'en');
    const slow = finishPuzzle({}, started, { solved: true, hints: 1, wrongChecks: 1, ms: 1_800_000 }, 'en');
    const none = finishPuzzle({}, started, { solved: true, hints: 1, wrongChecks: 1 }, 'en');
    expect(slow.ratings).toEqual(fast.ratings);
    expect(none.ratings).toEqual(fast.ratings);
    const { ms: _a, ...fastEvent } = fast.event;
    const { ms: _b, ...slowEvent } = slow.event;
    expect(slowEvent).toEqual(fastEvent);
    expect(replayPuzzleRatings([slow.event])).toEqual(replayPuzzleRatings([fast.event]));
  });

  it('maps violation ids to message keys', () => {
    expect(violationKey('scale:2')).toBe('puzzle.violated.scale');
    expect(violationKey('wide')).toBe('puzzle.violated.wide');
    expect(violationKey('col:0')).toBe('puzzle.violated.col');
    expect(violationKey('whatever')).toBe('puzzle.violated.answer');
  });
});

// ── integration: the puzzle mode in the app ──────────────────────────────────
describe('puzzle mode integration', () => {
  const T = Date.now();
  const placedKid = (age: number): Profile => {
    const p = createProfile({ name: 'Марко', age, locale: 'mk', avatar: 'color.green' }, T);
    const today = dayKey(now());
    return saveProfile({
      ...p,
      placement: { done: true, state: null, g: 3.5, sd: 0.3 },
      quests: { day: today, ids: questsForDay(p.id, today, p.band), done: [], rewarded: false },
    });
  };

  it('a day of puzzles only neither lights the spark nor advances quests, but counts as a session', () => {
    repo.init();
    let p = placedKid(9);
    setState({ profile: p, profiles: [p], session: null, meta: repo.meta() });
    let s = startPuzzleSession(p);
    const types = puzzleTypesFor(p.band).map((d) => d.id);
    for (let i = 0; i < 12; i++) {
      const started = beginPuzzle(p, types[i % types.length]!, false);
      const r = completePuzzle(p, s, started, { solved: true, hints: i % 2, wrongChecks: 1, fails: ['next'] });
      p = r.profile;
      s = r.session;
    }
    const end = endPuzzleSession(p, s);
    p = end.profile;
    const log = recentLog(p.id);
    expect(log.filter((r) => r.type === 'item')).toEqual([]);
    const sess = log.filter((r): r is SessionRecord => r.type === 'session');
    expect(sess.map((r) => [r.phase, r.mode])).toEqual([['start', 'puzzle'], ['end', 'puzzle']]);
    expect(sess[1]!.items).toBe(12);
    expect(sess[1]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(log.filter((r) => r.type === 'event' && r.name === EVENTS.PUZZLE)).toHaveLength(12);
    expect(p.streak.activeDays).toEqual([]);
    expect(p.quests!.done).toEqual([]);
    expect(updateQuests(p, null).quests!.done).toEqual([]);
    expect(p.stats.sessions).toBe(1);
    expect(p.stats.items).toBe(0);
    expect(Object.values(p.puzzles).reduce((n, r) => n + r.n, 0)).toBe(12);
    // Ten solved puzzles earn "Puzzle Solver" (effort), logged like any achievement.
    expect(p.achievements['puzzle.solver']).toBeDefined();
    expect(p.achievements['puzzle.aboveLevel']).toBeUndefined();
    // The profile's ratings are exactly what the log replays to.
    expect(replayPuzzleRatings(puzzleEventsFromLog(log))).toEqual(p.puzzles);
  });

  it('starts each band at its own prior, so teens do not open on trivial puzzles', () => {
    const lv = (b: BandId): number => puzzleLevelFor(undefined, PUZZLE_TARGET.NORMAL, T0, b);
    expect(lv('A')).toBeLessThan(lv('B'));
    expect(lv('B')).toBeLessThan(lv('C'));
    expect(PUZZLE_PRIORS.B.mu).toBe(0);
    expect(PUZZLE_PRIORS.C.mu).toBe(0.5);
    // Replay uses the prior of the band on the type's first event.
    const started = startPuzzle(getPuzzleType('pattern'), 'C', undefined, PUZZLE_TARGET.NORMAL, T0, 5);
    const live = finishPuzzle({}, started, { solved: true, hints: 0, wrongChecks: 0 }, 'mk');
    expect(replayPuzzleRatings([live.event])).toEqual(live.ratings);
    expect(replayPuzzleRatings([{ ...live.event, band: 'A' }])).not.toEqual(live.ratings);
  });

  it('merges profile.puzzles per type: the copy with more rated puzzles wins, idempotently', () => {
    const base = createProfile({ name: 'А', age: 9, locale: 'mk', avatar: 'color.green' }, T0);
    const r = (n: number, lastSeen: number, mu = n / 10): PuzzleRating => ({ mu, s2: 1, n, lastSeen, solved: n });
    const a: Profile = { ...base, puzzles: { pattern: r(5, 100), crypt: r(2, 50) } };
    const b: Profile = { ...base, updatedAt: base.updatedAt + 1, puzzles: { pattern: r(3, 900), balance: r(2, 10), crypt: r(2, 60, 9) } };
    const m = mergeProfiles(a, b);
    expect(m.puzzles).toEqual({ pattern: r(5, 100), crypt: r(2, 60, 9), balance: r(2, 10) });
    expect(mergeProfiles(b, a).puzzles).toEqual(m.puzzles);
    expect(mergeProfiles(m, b).puzzles).toEqual(m.puzzles);
    expect(mergeProfiles(m, m).puzzles).toEqual(m.puzzles);
    // A profile written before puzzles existed merges cleanly.
    const old = { ...base } as Partial<Profile>;
    delete old.puzzles;
    expect(mergeProfiles(old as Profile, a).puzzles).toEqual(a.puzzles);
  });

  it('estimate feedback never reveals a direction; the event log keeps the precise violation', () => {
    expect(new Set([PUZZLE_VIOLATION_KEYS.below, PUZZLE_VIOLATION_KEYS.above])).toEqual(new Set(['puzzle.violated.outside']));
    const shown = new Set<string>();
    for (const b of ['B', 'C'] as const) {
      for (const p of sample<EstimatePuzzle>(estimatePuzzle, b, SEEDS)) {
        const tv = toNumber(estimateTruth(p.q));
        const w = p.maxWidth;
        for (const a of [[tv + 1, tv + 1 + w], [tv - 2 * w, tv - w], [tv - 3 * w, tv - w], [tv - w, tv + w]] as EstimateAnswer[]) {
          for (const v of estimatePuzzle.check(p, a).violated ?? []) shown.add(violationKey(v));
        }
      }
    }
    expect([...shown].sort()).toEqual(['puzzle.violated.outside', 'puzzle.violated.wide']);
    const en = getLocale('en').messages;
    const mk = getLocale('mk').messages;
    for (const k of Object.keys(en)) expect(k).not.toMatch(/^puzzle\.violated\.(below|above)$/);
    for (const k of ['puzzle.violated.outside', 'puzzle.violated.wide']) {
      expect(en[k]).not.toMatch(/\b(low|high|below|above|left|right|up|down|more|less|bigger|smaller)\b/i);
      expect(mk[k]).not.toMatch(/(ниско|високо|под |над |лево|десно|повеќе|помалку|поголем|помал)/i);
    }
    // The log is precise.
    const started = startPuzzle(estimatePuzzle, 'B', undefined, PUZZLE_TARGET.NORMAL, T0, 3);
    const ev = finishPuzzle({}, started, { solved: true, hints: 0, wrongChecks: 2, fails: ['below', 'wide+above'] }, 'mk').event;
    expect(ev.fails).toEqual(['below', 'wide+above']);
    expect(parsePuzzleEvent(JSON.parse(JSON.stringify(ev)))!.fails).toEqual(['below', 'wide+above']);
  });

  it('every message key the core emits has strings in both locales', () => {
    const keys = [...Object.values(PUZZLE_TYPE_KEYS), ...Object.values(PUZZLE_VIOLATION_KEYS), ...PUZZLE_HINT_KEYS];
    for (const loc of ['en', 'mk']) {
      const msgs = getLocale(loc).messages;
      expect(keys.filter((k) => !(k in msgs)), loc).toEqual([]);
      for (const d of allPuzzleTypes()) expect(`puzzle.about.${d.id}` in msgs && `puzzle.ask.${d.id}` in msgs, `${loc} ${d.id}`).toBe(true);
    }
  });

  describe('achievements', () => {
    const ctx = (p: Profile, log: LogRecord[] = []): EvalContext => ({
      profile: p, now: T0, today: dayKey(T0), log, sessionId: 's1', graph: GRAPH, modesAvailable: 3, memo: new Map(),
    });
    const kid = (band: BandId, puzzles: PuzzleRatings = {}): Profile => ({
      ...createProfile({ name: 'К', age: band === 'A' ? 6 : band === 'B' ? 9 : 13, locale: 'mk', avatar: 'color.green' }, T0),
      puzzles,
    });
    const solvedEv = (type: string, target: number, solved = true): LogRecord => ({
      type: 'event', ts: T0, sid: 's1', name: EVENTS.PUZZLE, data: { type, target, solved, y: solved ? 1 : 0 },
    });
    const rating = (solved: number): PuzzleRating => ({ mu: 0, s2: 1, n: solved + 3, lastSeen: T0, solved });
    const got = (p: Profile, log?: LogRecord[]): string[] => evaluateAchievements(ACHIEVEMENTS, ctx(p, log), 'item');

    it('are valid: none rewards correctness alone', () => {
      expect(validateAchievements(ACHIEVEMENTS)).toEqual([]);
      for (const id of ['puzzle.solver', 'puzzle.aboveLevel', 'puzzle.estimator']) expect(ACHIEVEMENTS.some((a) => a.id === id)).toBe(true);
    });

    it('Puzzle Solver: ten solved puzzles of any type, in every band', () => {
      expect(got(kid('A', { pattern: rating(6), balance: rating(3) }))).not.toContain('puzzle.solver');
      expect(got(kid('A', { pattern: rating(6), balance: rating(4) }))).toContain('puzzle.solver');
      expect(got(kid('C', { crypt: rating(10) }))).toContain('puzzle.solver');
    });

    it('Above My Level: one puzzle solved from the "Harder one" chip (Bands B/C)', () => {
      expect(got(kid('B'), [solvedEv('pattern', PUZZLE_TARGET.NORMAL)])).not.toContain('puzzle.aboveLevel');
      expect(got(kid('B'), [solvedEv('pattern', PUZZLE_TARGET.HARDER, false)])).not.toContain('puzzle.aboveLevel');
      expect(got(kid('B'), [solvedEv('balance', PUZZLE_TARGET.HARDER)])).toContain('puzzle.aboveLevel');
      expect(got(kid('A'), [solvedEv('balance', PUZZLE_TARGET.HARDER)])).not.toContain('puzzle.aboveLevel');
    });

    it('Estimator: ten solved estimation ranges (Bands B/C)', () => {
      expect(got(kid('B', { estimate: rating(9), pattern: rating(20) }))).not.toContain('puzzle.estimator');
      expect(got(kid('C', { estimate: rating(10) }))).toContain('puzzle.estimator');
      expect(got(kid('A', { estimate: rating(10) }))).not.toContain('puzzle.estimator');
    });
  });
});
