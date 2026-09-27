/**
 * The adaptive hint ladder (DESIGN §1.5, §1.11; §4 step 5):
 *  - no rung of any playable binding's items gives the answer away, in any
 *    locale or band tone; no tier-2 hop lands on (or starts at) the answer;
 *  - every core solution key has its own strategy prompt, unknown keys fall
 *    back to the generic one, and strategy prompts carry no numbers;
 *  - credit y = 1 − 0.25·tier, live and in replay; placement counts a
 *    correct answer only without hints;
 *  - legacy logs (hint without tier) replay to exactly the states the
 *    single-hint engine produced;
 *  - the log codec carries `tier`, and old records decode with tier = null;
 *  - the pulse delay follows the child's median latency on the skill.
 */
import { describe, expect, it } from 'vitest';
import { glickoElo } from '../src/core/engine/glicko';
import { applyFirstAttempt, hintCredit, hintTierOf } from '../src/core/engine/observe';
import { MODEL } from '../src/core/engine/params';
import { startPlacement } from '../src/core/engine/placement';
import { replay } from '../src/core/engine/replay';
import { SessionEngine, type AnswerInput, type PresentedItem } from '../src/core/engine/session';
import { getGenerator } from '../src/core/items/generators';
import {
  allStrategyIds,
  GENERIC_STRATEGY,
  HINT_PULSE,
  hintLadder,
  pulseDelayMs,
  STRATEGY_BY_SOL,
  strategyId,
} from '../src/core/items/hints';
import type { Item } from '../src/core/items/types';
import { decodeRecord, encodeRecord } from '../src/core/log/codec';
import type { ItemRecord, LogRecord } from '../src/core/log/types';
import { toNumber } from '../src/core/rational';
import { createRng } from '../src/core/rng';
import { GRAPH } from '../src/core/skills';
import type { BandId } from '../src/core/types';
import { allLocales, getLocale } from '../src/i18n/locales';
import { answerText, solutionText } from '../src/i18n/render';

const EN = getLocale('en').numbers;
const locales = allLocales();
const BANDS: BandId[] = ['B', 'C'];

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isSep = (c: string): boolean => c === ',' || c === '.' || c === ' ';

/** Whether `text` shows the number `n` (formatted), not merely as part of a longer or signed number. */
function mentions(text: string, n: string): boolean {
  for (let i = text.indexOf(n); i >= 0; i = text.indexOf(n, i + 1)) {
    const b1 = text[i - 1] ?? '';
    const b2 = text[i - 2] ?? '';
    const a1 = text[i + n.length] ?? '';
    const a2 = text[i + n.length + 1] ?? '';
    const before = isDigit(b1) || (isSep(b1) && isDigit(b2)) || (!n.startsWith('−') && (b1 === '−' || b1 === '-'));
    const after = isDigit(a1) || (isSep(a1) && isDigit(a2));
    if (!before && !after) return true;
  }
  return false;
}

/** `count` items of a binding, spread over levels, as the engine would bind them. */
function itemsOf(skillId: string, b: { id: string; config?: Record<string, unknown> }, count: number): Item[] {
  const gen = getGenerator(b.id);
  const out: Item[] = [];
  for (let i = 0; i < count; i++) {
    const g = gen.generate((i % 21) / 20, createRng(1009 + i * 7919), b.config ?? {});
    out.push({ ...g, key: String(i + 1), skillId, genId: gen.id, genVersion: gen.version, seed: i });
  }
  return out;
}

const bindings = GRAPH.playableSkills().flatMap((s) => (s.gens ?? []).map((g) => ({ skill: s.id, g })));

describe('the number matcher used below', () => {
  it('finds whole numbers only', () => {
    expect(mentions('Split 47 into 40 and 7.', '7')).toBe(true);
    expect(mentions('Split 47 into 40 and 7.', '4')).toBe(false);
    expect(mentions('300, 40 and 5', '40')).toBe(true);
    expect(mentions('1,234 and 5', '234')).toBe(false);
    expect(mentions('од 12 345 до 12 355', '12 345')).toBe(true);
    expect(mentions('−3 − (−8) = −3 + 8', '3')).toBe(false);
    expect(mentions('−3 − (−8) = −3 + 8', '−3')).toBe(true);
    expect(mentions('10 − 3', '3')).toBe(true);
    expect(mentions('0,5', '5')).toBe(false);
  });
});

describe('hint ladder never gives the answer away', () => {
  for (const { skill, g } of bindings) {
    it(`${skill} via ${g.id}: 200 items, every locale and tone`, () => {
      for (const item of itemsOf(skill, g, 200)) {
        const ladder = hintLadder(item);
        const label = `${skill}#${item.key}`;
        expect(ladder[0]?.tier, label).toBe(1);
        for (let i = 1; i < ladder.length; i++) expect(ladder[i]!.tier, label).toBeGreaterThan(ladder[i - 1]!.tier);
        const ans = toNumber(item.answer.value);
        const hop = ladder.find((r) => r.tier === 2)?.hop;
        if (hop) {
          const first = item.solution.find((s) => s.k === 'hop');
          expect(first, label).toMatchObject(hop);
          expect(hop.to, `${label} tier-2 hop ends on the answer`).not.toBe(ans);
          expect(hop.from, `${label} tier-2 hop starts at the answer`).not.toBe(ans);
          if (item.line.answerMode === 'count') expect(hop.to, `${label} tier-2 hop reaches the flag`).not.toBe(item.line.flag);
        }
        for (const loc of locales) {
          const shown = answerText(item, loc.id);
          for (const band of BANDS) {
            for (const r of ladder) {
              const text = solutionText(r.say, loc.id, band);
              expect(text, `${label} tier ${r.tier} unresolved key`).not.toBe(r.say.key);
              expect(mentions(text, shown), `${label} ${loc.id}/${band} tier ${r.tier}: "${text}" shows ${shown}`).toBe(false);
            }
          }
        }
      }
    });
  }

  it('the Hop e2e skill (as.add.multi) offers all three tiers on most items', () => {
    const b = GRAPH.get('as.add.multi').gens![0]!;
    const full = itemsOf('as.add.multi', b, 100).filter((it) => hintLadder(it).length === 3).length;
    expect(full).toBeGreaterThan(50);
  });
});

describe('strategy prompts', () => {
  const has = (loc: (typeof locales)[number], k: string): boolean => k in loc.messages;

  it('every core solution key a generator emits has its own strategy (feature keys sol.<feature>.* may fall back)', () => {
    const emitted = new Set<string>();
    for (const { skill, g } of bindings) for (const it of itemsOf(skill, g, 60)) it.solution.forEach((s) => s.k === 'say' && emitted.add(s.key));
    const core = [...emitted].filter((k) => /^sol\.[A-Za-z0-9]+$/.test(k));
    expect(core.length).toBeGreaterThan(20);
    expect(core.filter((k) => !(k in STRATEGY_BY_SOL))).toEqual([]);
  });

  it('every strategy id has a prompt in every locale, and no prompt contains a digit', () => {
    for (const loc of locales) {
      expect(allStrategyIds().filter((id) => !has(loc, `hint.s.${id}`)), loc.id).toEqual([]);
      const digits = Object.entries(loc.messages).filter(([k, v]) => k.startsWith('hint.s.') && /\d/.test(v));
      expect(digits, loc.id).toEqual([]);
    }
  });

  it('maps items to precise strategies, by operation where the key is shared', () => {
    const first = (skillId: string, pred: (it: Item) => boolean, gi = 0): Item => {
      const b = GRAPH.get(skillId).gens![gi]!;
      const found = itemsOf(skillId, b, 400).find(pred);
      if (!found) throw new Error(`no matching ${skillId} item`);
      return found;
    };
    const says = (it: Item): string[] => it.solution.flatMap((s) => (s.k === 'say' ? [s.key] : []));
    expect(strategyId(first('as.add.20', (it) => says(it)[0] === 'sol.makeTen'))).toBe('makeTen');
    expect(strategyId(first('as.sub.20', (it) => says(it)[0] === 'sol.backThroughTen'))).toBe('backThroughTen');
    expect(strategyId(first('as.add.100', (it) => says(it)[0] === 'sol.split2'))).toBe('split.add');
    expect(strategyId(first('as.sub.100', (it) => says(it)[0] === 'sol.split2'))).toBe('split.sub');
    expect(strategyId(first('md.mult.multi', (it) => says(it)[0] === 'sol.split2'))).toBe('split.mul');
    expect(strategyId(first('as.add.multi', (it) => says(it)[0] === 'sol.step'))).toBe('step.add');
    expect(strategyId(first('as.sub.multi', (it) => says(it)[0] === 'sol.step'))).toBe('step.sub');
    expect(strategyId(first('md.mult.facts', (it) => says(it).includes('sol.times9')))).toBe('times9');
    expect(strategyId(first('md.div.facts', () => true))).toBe('divAsHops');
    expect(strategyId(first('int.addsub', (it) => says(it)[0] === 'sol.subNeg'))).toBe('subNeg');
    // Word problems keep their base strategy (the operation comes from the worked steps).
    expect(strategyId(first('as.add.multi', (it) => it.prompt.kind === 'word' && says(it)[0] === 'sol.split3', 1))).toBe('split.add');
  });

  it('falls back to the generic prompt for an unknown key or an item without worked steps', () => {
    const base = itemsOf('as.add.multi', GRAPH.get('as.add.multi').gens![0]!, 1)[0]!;
    const unknown: Item = { ...base, solution: [{ k: 'say', key: 'sol.frac.someday', params: {} }] };
    expect(strategyId(unknown)).toBe(GENERIC_STRATEGY);
    expect(hintLadder(unknown)[0]!.say.key).toBe('hint.s.generic');
    const bare = itemsOf('num.line.20', GRAPH.get('num.line.20').gens![0]!, 1)[0]!;
    expect(bare.solution.some((s) => s.k === 'say')).toBe(false);
    expect(strategyId(bare)).toBe(GENERIC_STRATEGY);
  });

  it('tier 3 is the first worked step that keeps the answer hidden (the old single hint)', () => {
    const b = GRAPH.get('as.add.multi').gens![0]!;
    for (const it of itemsOf('as.add.multi', b, 50)) {
      const ans = toNumber(it.answer.value);
      const expected = it.solution.find((s) => s.k === 'say' && !s.key.startsWith('sol.count') && !Object.values(s.params).some((v) => v === ans));
      expect(hintLadder(it).find((r) => r.tier === 3)?.say).toEqual(expected);
    }
  });
});

// ── credit ──────────────────────────────────────────────────────────────────
const T0 = Date.UTC(2026, 8, 1, 12);

describe('hint credit y = 1 − 0.25·tier', () => {
  it('maps tiers to credit, and a legacy hint to tier 2 = the old HINT_CREDIT', () => {
    expect([0, 1, 2, 3].map(hintCredit)).toEqual([1, 0.75, 0.5, 0.25]);
    expect(MODEL.HINT_TIER_PENALTY).toBe(0.25);
    expect(hintTierOf(false, null)).toBe(0);
    expect(hintTierOf(false, undefined)).toBe(0);
    expect(hintTierOf(true, null)).toBe(MODEL.LEGACY_HINT_TIER);
    expect(hintTierOf(true, undefined)).toBe(2);
    expect(hintTierOf(true, 1)).toBe(1);
    expect(hintTierOf(false, 3)).toBe(3);
    expect(hintCredit(hintTierOf(true, null))).toBe(MODEL.HINT_CREDIT);
  });

  it('is the outcome the model is updated with: more help, less evidence', () => {
    const skill = GRAPH.get('as.add.multi');
    const st = { [skill.id]: glickoElo.init(skill, T0) };
    const obs = { correct: true, difficulty: 0.2, ts: T0 + 60_000, timed: false };
    const mus = [0, 1, 2, 3].map((tier) => {
      const via = applyFirstAttempt({ graph: GRAPH, model: glickoElo }, st, skill.id, { ...obs, hint: tier > 0, hintTier: tier }).states[skill.id]!.mu;
      const direct = glickoElo.update(st[skill.id]!, { y: 1 - 0.25 * tier, difficulty: 0.2, ts: T0 + 60_000, weight: 1 }).mu;
      expect(via, `tier ${tier}`).toBeCloseTo(direct, 12);
      return via;
    });
    for (let i = 1; i < mus.length; i++) expect(mus[i]!).toBeLessThan(mus[i - 1]!);
  });

  const engine = (placement: boolean, seed = 11): SessionEngine => {
    let t = T0;
    return new SessionEngine(
      { graph: GRAPH, model: glickoElo, now: () => (t += 4000) },
      { skills: {}, placement: placement ? { done: false, state: startPlacement(9) } : { done: true, state: null } },
      {
        sessionId: 's1', seed, band: { id: 'B', targetP: 0.85, allowReading: true, maxReturns: 1 },
        mode: { id: 'hop', requires: ['numberLine'] }, plannedItems: 6, stretch: false, timed: false,
        ...(placement ? {} : { only: ['as.add.multi'] }),
      },
    );
  };
  const input = (p: PresentedItem, right: boolean, hintTier?: number): AnswerInput => {
    const ans = toNumber(p.item.answer.value);
    return {
      response: { kind: 'typed', raw: String(right ? ans : ans + 1) },
      latencyMs: 9000, hint: (hintTier ?? 0) > 0, locale: 'en', conv: EN, input: 'typed',
      ...(hintTier === undefined ? {} : { hintTier }),
    };
  };

  it('live answers log the tier, and replay applies the same credit', () => {
    const e = engine(false);
    const records: ItemRecord[] = [];
    let i = 0;
    for (let p = e.next(); p; p = e.next(), i++) {
      const r = e.answer(p, input(p, true, i % 4));
      records.push(r.record!);
      expect(r.record!.tier).toBe(i % 4);
      expect(r.record!.hint).toBe(i % 4 > 0);
    }
    expect(e.stats.firstCorrect).toBe(records.filter((r) => r.tier === 0).length);
    const st = e.snapshot.skills['as.add.multi']!;
    const rep = replay({ graph: GRAPH, model: glickoElo }, records)['as.add.multi']!;
    expect(rep.mu).toBeCloseTo(st.mu, 3);
    expect(rep.s2).toBeCloseTo(st.s2, 3);
  });

  it('a mode without tiers logs tier 0, or null for a hint (legacy credit)', () => {
    const e = engine(false);
    const p1 = e.next()!;
    expect(e.answer(p1, input(p1, true)).record!.tier).toBe(0);
    const p2 = e.next()!;
    const r2 = e.answer(p2, { ...input(p2, true), hint: true });
    expect(r2.record!.tier).toBeNull();
    expect(r2.record!.hint).toBe(true);
  });

  it('placement counts an answer as correct only at tier 0', () => {
    const post = (right: boolean, tier: number): number[] => {
      const e = engine(true);
      const p = e.next()!;
      expect(p.source).toBe('placement');
      e.answer(p, input(p, right, tier));
      return e.snapshot.placement.state!.post;
    };
    const clean = post(true, 0);
    const wrong = post(false, 0);
    expect(clean).not.toEqual(wrong);
    for (const tier of [1, 2, 3]) expect(post(true, tier), `tier ${tier}`).toEqual(wrong);
  });
});

// ── legacy replay parity ───────────────────────────────────────────────────
const LEGACY_SKILLS = ['as.add.multi', 'as.sub.multi', 'md.mult.facts', 'md.div.facts', 'md.mult.multi', 'int.addsub'];
/** Fields of an item record before `tier` was appended (encoded length = 2 + this). */
const LEGACY_ITEM_FIELDS = 27;

/** A synthetic pre-ladder log: hints are booleans only. */
function legacyLog(): LogRecord[] {
  const rng = createRng(20260105);
  const t0 = Date.UTC(2026, 0, 5, 15);
  const out: LogRecord[] = [{ type: 'event', ts: t0, sid: null, name: 'placement_done', data: { g: 3.4, sd: 0.35 } }];
  let ts = t0;
  for (let i = 0; i < 160; i++) {
    ts += rng.int(4_000, 45_000) + (i % 40 === 39 ? 3 * 86_400_000 : 0);
    const skill = LEGACY_SKILLS[rng.int(0, LEGACY_SKILLS.length - 1)]!;
    const level = Math.round(rng.next() * 1000) / 1000;
    const correct = rng.chance(0.72);
    const hint = rng.chance(0.35);
    const timed = rng.chance(0.08);
    const attempt = !correct && rng.chance(0.25) ? 2 : 1;
    out.push({
      type: 'item', ts, sid: `s${Math.floor(i / 12)}`, key: String(i), skill, gen: 'addsub', genV: 1, seed: i,
      level, diff: Math.round((-2.5 + 5 * level) * 1000) / 1000, p: 0.8, mu: 0, s2: 1, correct, attempt,
      latency: rng.int(1500, 20000), hint, answer: '1', expected: correct ? '1' : '2', mis: null,
      // A synthetic second mode at full evidence weight (GOLDEN was captured before any mode had a weight;
      // the real 'target' mode now weighs 0.5).
      mode: i % 9 === 0 ? 'legacy.other' : 'hop', band: 'B', locale: i % 2 ? 'mk' : 'en', source: 'frontier',
      timed, input: 'typed', hops: null, alt: false,
    });
  }
  return out;
}

/**
 * States the single-hint engine (y = HINT_CREDIT = 0.5 for any hint) produced
 * for legacyLog(), captured from main at 2de0abf before the ladder existed.
 */
const GOLDEN = {
  'as.add.multi': { mu: 0.833800133027994, s2: 0.5221543933782796, n: 24, correct: 10, recent: 220, status: 'learning', h: null },
  'as.sub.multi': { mu: 0.6602006823000985, s2: 0.5546213498930014, n: 26, correct: 12, recent: 21, status: 'learning', h: null },
  'md.mult.facts': { mu: 1.5760322126758017, s2: 0.42480374253939207, n: 23, correct: 9, recent: 38, status: 'proficient', h: 2 },
  'md.div.facts': { mu: 1.4246927027281246, s2: 0.506273640250402, n: 20, correct: 11, recent: 101, status: 'learning', h: null },
  'md.mult.multi': { mu: 0.3134057500606433, s2: 0.42690496748721135, n: 26, correct: 8, recent: 37, status: 'learning', h: null },
  'int.addsub': { mu: -0.06195723577776821, s2: 0.49890327803401874, n: 24, correct: 6, recent: 194, status: 'learning', h: null },
} as const;

describe('legacy replay parity', () => {
  const summary = (states: ReturnType<typeof replay>): Record<string, unknown> =>
    Object.fromEntries(
      LEGACY_SKILLS.map((id) => {
        const s = states[id]!;
        return [id, { mu: s.mu, s2: s.s2, n: s.n, correct: s.correct, recent: s.recent, status: s.status, h: s.h ?? null }];
      }),
    );
  /** The log as an old build wrote it: item records without the `tier` tail. */
  const oldOnDisk = (): unknown[] =>
    legacyLog().map((r) => {
      const enc = encodeRecord(r);
      return r.type === 'item' ? enc.slice(0, 2 + LEGACY_ITEM_FIELDS) : enc;
    });
  const decodeAll = (arrs: unknown[]): LogRecord[] => arrs.map((a) => decodeRecord(JSON.parse(JSON.stringify(a))) as LogRecord);

  it('old logs decode with tier = null and replay to exactly the single-hint states', () => {
    const decoded = decodeAll(oldOnDisk());
    const items = decoded.filter((r): r is ItemRecord => r.type === 'item');
    expect(items.every((r) => r.tier === null)).toBe(true);
    expect(items.filter((r) => r.hint && r.correct && r.attempt === 1 && !r.timed).length).toBeGreaterThan(20);
    expect(summary(replay({ graph: GRAPH, model: glickoElo }, decoded))).toEqual(GOLDEN);
  });

  it('a legacy hint is exactly tier 2, and the parity is not vacuous (tier 1 would differ)', () => {
    const decoded = decodeAll(oldOnDisk());
    const withTier = (tier: number): LogRecord[] => decoded.map((r) => (r.type === 'item' && r.hint ? { ...r, tier } : r));
    expect(summary(replay({ graph: GRAPH, model: glickoElo }, withTier(2)))).toEqual(GOLDEN);
    const tier1 = summary(replay({ graph: GRAPH, model: glickoElo }, withTier(1))) as typeof GOLDEN;
    expect(tier1['as.add.multi'].mu).not.toBeCloseTo(GOLDEN['as.add.multi'].mu, 6);
  });
});

// ── codec ───────────────────────────────────────────────────────────────────
describe('log codec with tier', () => {
  const rec = (over: Partial<ItemRecord> = {}): ItemRecord => ({
    type: 'item', ts: T0, sid: 's1', key: '3', skill: 'as.add.multi', gen: 'addsub', genV: 1, seed: 9,
    level: 0.5, diff: 0, p: 0.8, mu: 0.4, s2: 0.6, correct: true, attempt: 1, latency: 14_000, hint: true,
    answer: '812', expected: '812', mis: null, mode: 'hop', band: 'B', locale: 'mk', source: 'frontier',
    timed: false, input: 'typed', hops: null, alt: false, tier: 3, ...over,
  });
  const trip = (r: ItemRecord): unknown => decodeRecord(JSON.parse(JSON.stringify(encodeRecord(r))));

  it('round-trips tier 0–3 and null, appended as the last field', () => {
    for (const tier of [0, 1, 2, 3, null]) expect(trip(rec({ tier, hint: !!tier }))).toEqual(rec({ tier, hint: !!tier }));
    const enc = encodeRecord(rec());
    expect(enc.length).toBe(2 + LEGACY_ITEM_FIELDS + 1);
    expect(enc[enc.length - 1]).toBe(3);
    expect(enc[1]).toBe(1); // no version bump
  });

  it('old records (no tail) decode with tier = null and otherwise unchanged', () => {
    const old = encodeRecord(rec()).slice(0, 2 + LEGACY_ITEM_FIELDS);
    const d = decodeRecord(old) as ItemRecord;
    expect(d.tier).toBeNull();
    expect(d).toEqual(rec({ tier: null }));
  });
});

// ── pulse ───────────────────────────────────────────────────────────────────
describe('hint button pulse delay', () => {
  const rec = (skill: string, latency: number, over: Partial<ItemRecord> = {}): ItemRecord => ({
    type: 'item', ts: T0, sid: 's', key: '1', skill, gen: 'addsub', genV: 1, seed: 1, level: 0.5, diff: 0, p: 0.8,
    mu: 0, s2: 1, correct: true, attempt: 1, latency, hint: false, answer: '1', expected: '1', mis: null, mode: 'hop',
    band: 'B', locale: 'mk', source: 'frontier', timed: false, input: 'typed', hops: null, alt: false, tier: 0, ...over,
  });

  it('is 1.5× the median latency on the skill (untimed first attempts only)', () => {
    const log = [10_000, 12_000, 30_000, 8_000, 11_000].map((l) => rec('as.add.multi', l));
    expect(pulseDelayMs(log, 'as.add.multi')).toBe(16_500);
    const noisy = [...log, rec('as.add.multi', 900, { timed: true }), rec('as.add.multi', 99_000, { attempt: 2 })];
    expect(pulseDelayMs(noisy, 'as.add.multi')).toBe(16_500);
  });

  it('falls back to the child’s overall median, then a default, and is clamped', () => {
    const other = [20_000, 20_000, 20_000].map((l) => rec('md.mult.facts', l));
    expect(pulseDelayMs([...other, rec('as.add.multi', 4000)], 'as.add.multi')).toBe(30_000);
    expect(pulseDelayMs([], 'as.add.multi')).toBe(HINT_PULSE.FACTOR * HINT_PULSE.DEFAULT_MEDIAN_MS);
    expect(pulseDelayMs([2000, 2500, 3000].map((l) => rec('x', l)), 'x')).toBe(HINT_PULSE.MIN_MS);
    expect(pulseDelayMs([90_000, 95_000, 99_000].map((l) => rec('x', l)), 'x')).toBe(HINT_PULSE.MAX_MS);
  });
});

