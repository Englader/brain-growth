/**
 * Grown-ups → Help (DESIGN §2.4, §5.2): one notion of help for every mode's
 * item records, old and new, and for puzzle events; the `revealed`, `ladder`
 * and `req` fields through the codec; the counts per period, per week, per
 * skill and per game; the recent list's questions rebuilt from the log in
 * both languages; and proof that none of it moves the engine.
 */
import { describe, expect, it } from 'vitest';
import '../src/modes';
import { hintUsage } from '../src/adult/analytics';
import { answerTexts, describeRecord, questionText, rebuildItem, TARGET_PROMPT_TYPE } from '../src/adult/helpItems';
import { countHelp, helpAnswers, helpBy, helpByWeek, helpSummary, periodStart, recentHelp } from '../src/adult/helpStats';
import { finishSession, recordAnswer, startSessionFor } from '../src/app/actions';
import { saveProfile } from '../src/app/persist';
import { repo } from '../src/app/services';
import { setState } from '../src/app/store';
import { glickoElo } from '../src/core/engine/glicko';
import { replay } from '../src/core/engine/replay';
import { SessionEngine } from '../src/core/engine/session';
import { getGenerator } from '../src/core/items/generators';
import { TARGET_PROMPT } from '../src/core/items/generators/makeIt';
import type { GeneratedItem, Item } from '../src/core/items/types';
import { decodeRecord, encodeRecord } from '../src/core/log/codec';
import { helpOf, ladderTierOf, puzzleHelpOf, refusedOnePanMoves, wasRevealed } from '../src/core/log/help';
import type { EventRecord, ItemRecord, LogRecord } from '../src/core/log/types';
import { EVENTS } from '../src/core/log/types';
import { createProfile, type Profile } from '../src/core/profile';
import { key } from '../src/core/rational';
import { createRng } from '../src/core/rng';
import { GRAPH } from '../src/core/skills';
import { EN_CONV, SimClock } from '../sim/harness';

const T = Date.UTC(2026, 8, 27, 10);
let seq = 0;

const rec = (over: Partial<ItemRecord> = {}): ItemRecord => {
  seq++;
  return {
    type: 'item', ts: T + seq, sid: 's1', key: `k${seq}`, skill: 'as.add.multi', gen: 'addsub', genV: 1, seed: seq,
    level: 0.5, diff: 0, p: 0.8, mu: 0.4, s2: 0.6, correct: true, attempt: 1, latency: 9000, hint: false,
    answer: '812', expected: '812', mis: null, mode: 'hop', band: 'B', locale: 'mk', source: 'frontier',
    timed: false, input: 'typed', hops: null, alt: false, tier: 0, revealed: false, ladder: null, req: null, ...over,
  };
};
/** A record as written before the Help tab: no revealed, ladder or req. */
const old = (over: Partial<ItemRecord> = {}): ItemRecord => {
  const r = rec(over);
  delete r.revealed;
  delete r.ladder;
  delete r.req;
  return decodeRecord(encodeRecord(r).slice(0, 2 + 28)) as ItemRecord;
};
const puzzle = (data: Record<string, unknown>, ts = T): EventRecord => ({
  type: 'event', ts, sid: 'p1', name: EVENTS.PUZZLE, data: { type: 'pattern', v: 1, seed: 1, level: 0.3, diff: -1, p: 0.7, y: 1, checks: 0, band: 'B', locale: 'mk', ts, ...data },
});

// ── helpOf ──────────────────────────────────────────────────────────────────
describe('helpOf: one notion of help across every mode', () => {
  it('Hop and Coord: the logged ladder tier; a legacy hint without a tier counts as tier 2', () => {
    expect(helpOf(rec())).toBe('none');
    expect(helpOf(rec({ hint: true, tier: 1 }))).toBe('hint1');
    expect(helpOf(rec({ hint: true, tier: 2 }))).toBe('hint2');
    expect(helpOf(rec({ hint: true, tier: 3, correct: false, answer: '800' }))).toBe('hint3');
    expect(helpOf(old({ hint: true, tier: null }))).toBe('hint2');
    expect(helpOf(old({ hint: false, tier: null }))).toBe('none');
    expect(helpOf(rec({ mode: 'coord', gen: 'coord', hint: true, tier: 1, answer: '3,-2', expected: '0' }))).toBe('hint1');
    // A wrong answer is not help.
    expect(helpOf(rec({ correct: false, answer: '700' }))).toBe('none');
  });

  it('Target: "show me" is shown (new records say so; old ones logged the answer "reveal"), whatever hints came first', () => {
    const t = { mode: 'target', gen: 'makeIt', skill: 'md.mult.facts', expected: '24' };
    expect(helpOf(rec({ ...t, correct: false, answer: 'reveal', revealed: true, hint: true, tier: 2 }))).toBe('shown');
    expect(helpOf(old({ ...t, correct: false, answer: 'reveal', hint: true, tier: 2 }))).toBe('shown');
    expect(helpOf(old({ ...t, band: 'A', gen: 'makeTen', correct: false, answer: 'reveal', tier: 0 }))).toBe('shown');
    expect(helpOf(rec({ ...t, answer: '(3*8)', hint: true, tier: 1 }))).toBe('hint1');
    expect(helpOf(rec({ ...t, answer: '(3*8)' }))).toBe('none');
  });

  it('Workshop: "show me" before any check is shown; hints by tier', () => {
    const w = { mode: 'workshop', gen: 'fracBar', skill: 'f.equiv', expected: '2/3' };
    expect(helpOf(rec({ ...w, correct: false, answer: 'reveal', revealed: true }))).toBe('shown');
    expect(helpOf(old({ ...w, correct: false, answer: 'reveal' }))).toBe('shown');
    expect(helpOf(old({ ...w, answer: '6|0,1,2,3', hint: true, tier: 2 }))).toBe('hint2');
  });

  it('Balance: the ladder tier, not the credit tier that also counts refused one-pan moves; "show me" (=?) is shown', () => {
    const b = { mode: 'balance', gen: 'equation', skill: 'al.eq.linear', expected: '3' };
    // New records log the ladder separately.
    expect(helpOf(rec({ ...b, answer: '!L:-4;-4;/2;=3', hint: true, tier: 2, ladder: 1 }))).toBe('hint1');
    expect(helpOf(rec({ ...b, answer: '!L:-4;-4;/2;=3', hint: true, tier: 1, ladder: 0 }))).toBe('none');
    expect(helpOf(rec({ ...b, answer: '-4;=?', correct: false, revealed: true, tier: 0, ladder: 0 }))).toBe('shown');
    // Old records: refused one-pan moves are read back from the transcript.
    expect(refusedOnePanMoves('!L:-4;!R:+2;-4;/2;=3')).toBe(2);
    expect(refusedOnePanMoves('!/4;-4;/2;=3')).toBe(0); // a both-pan split into 4 is refused for another reason: free
    expect(refusedOnePanMoves('not a transcript')).toBe(0);
    expect(helpOf(old({ ...b, answer: '!L:-4;-4;/2;=3', hint: true, tier: 1 }))).toBe('none');
    expect(ladderTierOf(old({ ...b, answer: '!L:-4;-4;/2;=3', hint: true, tier: 3 }))).toBe(2);
    expect(helpOf(old({ ...b, answer: '-4;/2;=3', hint: true, tier: 2 }))).toBe('hint2');
    expect(helpOf(old({ ...b, answer: '-4;=?', correct: false, tier: 0 }))).toBe('shown');
    expect(wasRevealed(old({ ...b, answer: '=?', correct: false }))).toBe(true);
  });

  it('Sprint and Dice Race have no help; the old-record heuristics never fire outside their modes', () => {
    expect(helpOf(rec({ mode: 'sprint', timed: true }))).toBe('none');
    expect(helpOf(old({ mode: 'dice', source: 'fixed', correct: false, answer: '90' }))).toBe('none');
    expect(wasRevealed(old({ mode: 'hop', correct: false, answer: '=?' }))).toBe(false);
    expect(wasRevealed(old({ correct: true, answer: 'reveal' }))).toBe(false);
    // A current record's own field wins.
    expect(wasRevealed(rec({ mode: 'balance', correct: false, answer: '=?', revealed: false }))).toBe(false);
  });

  it('puzzles: solved by hints used (three or more is level 3); revealed or finished together is shown', () => {
    expect(puzzleHelpOf({ solved: true, hints: 0 })).toBe('none');
    expect(puzzleHelpOf({ solved: true, hints: 1 })).toBe('hint1');
    expect(puzzleHelpOf({ solved: true, hints: 2 })).toBe('hint2');
    expect(puzzleHelpOf({ solved: true, hints: 5 })).toBe('hint3');
    expect(puzzleHelpOf({ solved: false, hints: 0 })).toBe('shown');
    expect(puzzleHelpOf({ solved: false, hints: 3 })).toBe('shown');
  });
});

// ── codec ───────────────────────────────────────────────────────────────────
describe('log codec: revealed, ladder and req', () => {
  const trip = (r: ItemRecord): unknown => decodeRecord(JSON.parse(JSON.stringify(encodeRecord(r))));

  it('round-trips, appended at the end with no version bump; req keeps full precision', () => {
    for (const r of [
      rec({ revealed: true, correct: false, answer: 'reveal' }),
      rec({ revealed: false, ladder: 2, tier: 3, hint: true }),
      rec({ req: 0.6180339887498949 }),
      rec({ req: 0 }),
    ]) expect(trip(r)).toEqual(r);
    const enc = encodeRecord(rec({ revealed: true, ladder: 1, req: 0.25 }));
    expect(enc[1]).toBe(1);
    expect(enc.slice(-4)).toEqual([0, 1, 1, 0.25]); // tier, revealed (as 1), ladder, req
  });

  it('records written before them decode with null, and the rest unchanged', () => {
    const r = rec({ hint: true, tier: 2 });
    const d = decodeRecord(encodeRecord(r).slice(0, 2 + 28)) as ItemRecord;
    expect(d).toEqual({ ...r, revealed: null, ladder: null, req: null });
  });
});

// ── the live path logs them ─────────────────────────────────────────────────
describe('the session actions log revealed, ladder and req', () => {
  const kid = (): Profile => saveProfile(createProfile({ name: 'Ема', age: 13, locale: 'mk', avatar: 'color.green' }, Date.now()));

  it('Hop: req is the level asked of the generator, and it rebuilds the presented item exactly', () => {
    repo.init();
    const p = kid();
    setState({ profile: p, profiles: [p], session: null, meta: repo.meta() });
    let s = startSessionFor(p, 'hop', { only: ['as.add.multi'] })!;
    let prof = p;
    for (let i = 0; i < 4; i++) {
      const presented = s.engine.next()!;
      const r = recordAnswer(prof, s, presented, { kind: 'typed', raw: key(presented.item.answer.value) }, { latencyMs: 4000, hint: i > 0, hintTier: i, input: 'typed', hops: 0 });
      prof = r.profile;
      s = r.session;
      const logged = r.res.record!;
      expect(logged.req).toBe(presented.item.req);
      expect(logged.revealed).toBe(false);
      expect(logged.ladder).toBeNull();
      expect(helpOf(logged)).toBe(['none', 'hint1', 'hint2', 'hint3'][i]);
      const again = rebuildItem(logged)!;
      expect({ prompt: again.prompt, answer: again.answer, line: again.line, solution: again.solution }).toEqual({
        prompt: presented.item.prompt, answer: presented.item.answer, line: presented.item.line, solution: presented.item.solution,
      });
    }
    finishSession(prof, s, true);
  });

  it('"show me" and the Balance ladder reach the record through SubmitMeta', () => {
    repo.init();
    const p = kid();
    setState({ profile: p, profiles: [p], session: null, meta: repo.meta() });
    const s = startSessionFor(p, 'balance', { only: ['al.eq.linear'] })!;
    const presented = s.engine.next()!;
    const r = recordAnswer(p, s, presented, { kind: 'built', value: null, repr: '!L:-1;=?', data: { bal: 1 } }, {
      latencyMs: 4000, hint: true, hintTier: 3, ladderTier: 2, revealed: true, input: 'typed', hops: 0,
    });
    const logged = r.res.record!;
    expect(logged).toMatchObject({ correct: false, revealed: true, ladder: 2, tier: 3 });
    expect(helpOf(logged)).toBe('shown');
    expect(repo.readKnownLog(p.id).filter((x) => x.type === 'item').at(-1)).toMatchObject({ revealed: true, ladder: 2 });
  });
});

// ── rebuilding items ────────────────────────────────────────────────────────
/** A record the way the engine writes it for a generated item. */
function recordFor(skill: string, genId: string, g: GeneratedItem, seed: number, req: number): ItemRecord {
  const gen = getGenerator(genId);
  return rec({ skill, gen: gen.id, genV: gen.version, seed, req, level: Math.round(g.level * 1000) / 1000, expected: key(g.answer.value) });
}

describe('rebuildItem', () => {
  it('rebuilds every playable binding exactly from gen, version, seed, req and the skill binding', () => {
    const master = createRng(2026);
    let n = 0;
    for (const s of GRAPH.playableSkills()) {
      for (const b of s.gens ?? []) {
        for (let i = 0; i < 6; i++) {
          const { seed, rng } = master.fork();
          const req = master.next();
          const g = getGenerator(b.id).generate(req, rng, b.config ?? {});
          const again = rebuildItem(recordFor(s.id, b.id, g, seed, req));
          expect(again, `${s.id} ${b.id}`).not.toBeNull();
          expect(again!.prompt).toEqual(g.prompt);
          expect(again!.line).toEqual(g.line);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(300);
  });

  it('refuses what it cannot rebuild faithfully: no req (older records), another generator version, a fixed item, a mismatch', () => {
    const cfg = GRAPH.get('as.add.100').gens!.find((b) => b.id === 'addsub')!.config ?? {};
    const g = getGenerator('addsub').generate(0.4, createRng(77), cfg);
    const r = recordFor('as.add.100', 'addsub', g, 77, 0.4);
    expect(rebuildItem(r)).not.toBeNull();
    expect(rebuildItem({ ...r, req: null })).toBeNull();
    expect(rebuildItem(old({ ...r }))).toBeNull();
    expect(rebuildItem({ ...r, genV: r.genV + 1 })).toBeNull();
    expect(rebuildItem({ ...r, source: 'fixed' })).toBeNull();
    expect(rebuildItem({ ...r, expected: '99999' })).toBeNull();
    expect(rebuildItem({ ...r, skill: 'no.such.skill' })).toBeNull();
    expect(rebuildItem({ ...r, gen: 'bonds' })).toBeNull(); // not this skill's binding
  });

  it('the Target prompt type matches the generator module', () => {
    expect(TARGET_PROMPT_TYPE).toBe(TARGET_PROMPT);
  });
});

// ── rendering in both languages ─────────────────────────────────────────────
/** A generated item of `skill` through `genId` whose prompt passes `ok`. */
function find(skill: string, genId: string, ok: (it: Item) => boolean): { item: Item; r: ItemRecord } {
  const b = GRAPH.get(skill).gens!.find((x) => x.id === genId)!;
  for (let seed = 1; seed < 400; seed++) {
    const req = (seed % 20) / 20;
    const g = getGenerator(genId).generate(req, createRng(seed), b.config ?? {});
    const r = recordFor(skill, genId, g, seed, req);
    const item = rebuildItem(r);
    if (item && ok(item)) return { item, r };
  }
  throw new Error(`no ${skill} item`);
}
const nbsp = ' ';

describe('the recent list rebuilds questions in the grown-up’s language', () => {
  it('Hop expressions: the locale’s operators and decimal mark', () => {
    const { item } = find('md.mult.facts', 'mult', (it) => it.prompt.kind === 'expr' && !it.prompt.rhs);
    const e = item.prompt.kind === 'expr' && item.prompt.expr.k === 'op' ? item.prompt.expr : null;
    const a = e!.a.k === 'num' ? e!.a.v : 0;
    const b = e!.b.k === 'num' ? e!.b.v : 0;
    expect(questionText(item, 'en', 'B')).toBe(`${a} × ${b} = ?`);
    expect(questionText(item, 'mk', 'B')).toBe(`${a} · ${b} = ?`);

    const dec = find('d.addsub', 'decAddSub', (it) => it.prompt.kind === 'expr');
    const en = questionText(dec.item, 'en', 'B');
    const mk = questionText(dec.item, 'mk', 'B');
    expect(en).toMatch(/^\d+\.\d+ [+−] \d+(\.\d+)? = \?$/);
    expect(mk).toBe(en.replace(/\./g, ','));
  });

  it('word problems, percent, comparisons and locating come out in each language', () => {
    const w = find('as.add.100', 'word', () => true);
    expect(questionText(w.item, 'en', 'B')).not.toBe(questionText(w.item, 'mk', 'B'));
    expect(questionText(w.item, 'mk', 'B')).toMatch(/[Ѐ-ӿ]/);

    const pct = find('d.percent', 'percentOf', () => true);
    const pp = pct.item.prompt.kind === 'percentOf' ? pct.item.prompt : null;
    expect(questionText(pct.item, 'en', 'B')).toBe(`What is ${pp!.pct}% of ${pp!.of}?`);
    expect(questionText(pct.item, 'mk', 'B')).toBe(`Колку е ${pp!.pct}${nbsp}% од ${pp!.of}?`);

    const cmp = find('f.compare', 'fracLine', (it) => it.prompt.kind === 'compare');
    expect(questionText(cmp.item, 'en', 'B')).toMatch(/^Which is (bigger|smaller): -?\d+\/\d+ or -?\d+\/\d+\?$/);
    expect(questionText(cmp.item, 'mk', 'B')).toMatch(/^Кој број е (поголем|помал): \d+\/\d+ или \d+\/\d+\?$/);

    const loc = find('num.line.100', 'locate', (it) => it.prompt.kind === 'locate');
    const target = loc.item.prompt.kind === 'locate' ? loc.item.prompt.target : 0;
    expect(questionText(loc.item, 'mk', 'B')).toMatch(new RegExp(`${target} на бројната права$`));
  });

  it('mode items: a Balance equation, a Target deal, a Workshop task, a coordinate point', () => {
    const bal = find('al.eq.linear', 'equation', () => true);
    expect(questionText(bal.item, 'en', 'C')).toMatch(/^Solve -?\d*x.* = .+$/);
    expect(questionText(bal.item, 'mk', 'C')).toMatch(/^Реши ја равенката -?\d*x.* = .+$/);

    const deal = find('md.mult.facts', 'makeIt', () => true);
    expect(questionText(deal.item, 'en', 'B')).toMatch(/^Make \d+ (from the cards|using all the cards) \d+(, \d+)+$/);
    expect(questionText(deal.item, 'mk', 'B')).toMatch(/^Направи \d+ (од картичките|со сите картички) \d+(, \d+)+$/);

    const bar = find('f.equiv', 'fracBar', () => true);
    expect(questionText(bar.item, 'mk', 'B')).toMatch(/\d+\/\d+/);

    const pt = find('geo.coord', 'coord', (it) => it.prompt.kind === 'custom' && it.prompt.data.read === 0);
    // Points are written as the textbook does, with a no-break space after the comma.
    expect(questionText(pt.item, 'en', 'C')).toMatch(/^Plot the point \(−?\d+,\u00A0−?\d+\)$/);
    expect(questionText(pt.item, 'mk', 'C')).toMatch(/^Означи ја точката \(−?\d+,\u00A0−?\d+\)$/);
  });

  it('answers: the child’s and the right one, the way each mode logged them', () => {
    const hop = find('as.add.100', 'addsub', (it) => it.prompt.kind === 'expr');
    const wrong = { ...hop.r, correct: false, answer: String(Number(hop.r.expected) + 1) };
    expect(answerTexts(wrong, hop.item, 'mk')).toEqual({ given: String(Number(hop.r.expected) + 1), correct: hop.r.expected });

    const dec = rec({ gen: 'decAddSub', skill: 'd.addsub', answer: '9/20', expected: '1/2', correct: false });
    expect(answerTexts(dec, null, 'en')).toEqual({ given: '0.45', correct: '0.5' });
    expect(answerTexts(dec, null, 'mk')).toEqual({ given: '0,45', correct: '0,5' });

    const bal = rec({ mode: 'balance', gen: 'equation', skill: 'al.eq.linear', answer: '!L:-4;-4;/2;=-3', expected: '3', correct: false });
    expect(answerTexts(bal, null, 'mk')).toEqual({ given: 'x = −3', correct: 'x = 3' });
    expect(answerTexts({ ...bal, answer: '-4;=?', revealed: true }, null, 'en').given).toBeNull();

    const deal = find('md.mult.facts', 'makeIt', () => true);
    const d = deal.item.prompt.kind === 'custom' ? (deal.item.prompt.data as { ways: string[]; target: number }) : null;
    const shown = answerTexts({ ...deal.r, mode: 'target', correct: false, answer: 'reveal', revealed: true }, deal.item, 'mk');
    expect(shown.given).toBeNull();
    expect(shown.correct).toMatch(new RegExp(`= ${d!.target}$`));
    expect(shown.correct).not.toMatch(/[×*]/); // mk writes · and :
    const tried = answerTexts({ ...deal.r, mode: 'target', correct: false, answer: '(2*3)' }, deal.item, 'en');
    expect(tried.given).toBe(`2 × 3 = ${d!.target}`);

    const bar = rec({ mode: 'workshop', gen: 'fracBar', skill: 'f.equiv', answer: '6|0,1,2,3', expected: '2/3', correct: true });
    expect(answerTexts(bar, null, 'en')).toEqual({ given: '4 of 6 parts shaded', correct: '2/3' });
    expect(answerTexts(bar, null, 'mk').given).toBe('обоени 4 од 6 дела');
    const rect = rec({ mode: 'workshop', gen: 'rectBuild', skill: 'geo.area.rect', answer: '3x4', expected: '12', correct: true });
    expect(answerTexts(rect, null, 'mk').given).toBe('правоаголник 3 на 4');
    const pt = rec({ mode: 'coord', gen: 'coord', skill: 'geo.coord', answer: '-2,3', expected: '0', correct: false });
    // Without the task, the record cannot say which point was right (the logged value is 0): no answer rather than a wrong one.
    expect(answerTexts(pt, null, 'mk')).toEqual({ given: `(−2,${nbsp}3)`, correct: null });
    const ptTask = find('geo.coord', 'coord', () => true);
    expect(answerTexts({ ...ptTask.r, mode: 'coord', answer: '-2,3', correct: false }, ptTask.item, 'mk').correct).toMatch(/^\(−?\d+,\u00A0−?\d+\)$/);
    expect(answerTexts({ ...rect, correct: false }, null, 'mk').correct).toBeNull();
    expect(answerTexts(old({ mode: 'target', gen: 'makeIt', skill: 'md.mult.facts', answer: 'reveal', expected: '24', correct: false }), null, 'en')).toEqual({ given: null, correct: null });
    // On a fraction skill a logged key stays a fraction (1/2, not 0.5).
    expect(answerTexts(rec({ gen: 'fracLine', skill: 'f.equiv', answer: '1/3', expected: '1/2', correct: false }), null, 'mk')).toEqual({ given: '1/3', correct: '1/2' });
  });

  it('a record that cannot be rebuilt keeps its answers and has no question', () => {
    const r = old({ skill: 'as.add.100', answer: '57', expected: '58', correct: false, hint: true, tier: 2 });
    expect(describeRecord(r, 'mk')).toEqual({ question: null, given: '57', correct: '58' });
  });
});

// ── aggregation ─────────────────────────────────────────────────────────────
describe('counts per period, per week, per skill and game; the recent list', () => {
  const NOW = new Date(2026, 8, 27, 18).getTime(); // a Sunday evening, local time
  /** 10:00 local time, `d` days before NOW. */
  const day = (d: number): number => new Date(2026, 8, 27 - d, 10).getTime();
  const log: LogRecord[] = [
    rec({ ts: day(60), hint: true, tier: 1, skill: 'as.add.100' }),
    rec({ ts: day(40), skill: 'as.add.100' }),
    rec({ ts: day(20), mode: 'target', gen: 'makeIt', skill: 'md.mult.facts', correct: false, answer: 'reveal', revealed: true }),
    rec({ ts: day(20) + 1, skill: 'as.add.100' }),
    rec({ ts: day(6), hint: true, tier: 3 }),
    rec({ ts: day(6) + 1, hint: true, tier: 2, attempt: 2 }), // a retry: listed, not counted
    rec({ ts: day(2) }),
    rec({ ts: day(1), timed: true, mode: 'sprint' }), // Sprint: left out
    puzzle({ solved: true, hints: 1 }, day(0)),
    puzzle({ solved: true, hints: 0, type: 'logic' }, day(0) + 1),
    puzzle({ solved: false, hints: 0, type: 'logic' }, day(3)),
  ];

  it('periods: the last 7 and 30 calendar days (today included) and all kept history', () => {
    expect(periodStart(NOW, 7)).toBe(new Date(2026, 8, 21, 0).getTime());
    expect(periodStart(NOW, null)).toBe(0);
    expect(helpSummary(log, NOW, 7)).toEqual({ total: 5, none: 2, hint1: 1, hint2: 0, hint3: 1, shown: 1 });
    expect(helpSummary(log, NOW, 30)).toEqual({ total: 7, none: 3, hint1: 1, hint2: 0, hint3: 1, shown: 2 });
    expect(helpSummary(log, NOW, null)).toEqual({ total: 9, none: 4, hint1: 2, hint2: 0, hint3: 1, shown: 2 });
    expect(helpSummary([], NOW, 7).total).toBe(0);
  });

  it('the pilot tile counts the same answers as the Help tab', () => {
    const all = helpSummary(log, NOW, null);
    expect(hintUsage(log)).toEqual({ n: all.total, used: all.total - all.none, share: (all.total - all.none) / all.total, byTier: [all.none, all.hint1, all.hint2, all.hint3], shown: all.shown });
  });

  it('by week: Monday to Sunday, oldest first, with empty weeks', () => {
    const weeks = helpByWeek(log, NOW, 4);
    expect(weeks.map((w) => w.monday)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']);
    expect(weeks.at(-1)).toEqual({ monday: '2026-09-21', n: 5, helped: 3, share: 3 / 5 });
    expect(weeks[0]).toMatchObject({ n: 0, share: null });
  });

  it('by skill (puzzles by type) and by game: most help first', () => {
    const topics = helpBy(log, NOW, null, 'topic');
    // All helped once here: the larger share comes first, then more answers.
    expect(topics.map((g) => g.id)).toEqual(['md.mult.facts', 'pattern', 'as.add.multi', 'logic', 'as.add.100']);
    expect(topics.at(-1)).toMatchObject({ id: 'as.add.100', puzzle: false, n: 3, helped: 1, shown: 0 });
    expect(topics.find((g) => g.id === 'logic')).toMatchObject({ puzzle: true, n: 2, helped: 1, shown: 1 });
    expect(topics.find((g) => g.id === 'md.mult.facts')).toMatchObject({ n: 1, helped: 1, shown: 1 });
    const modes = helpBy(log, NOW, 7, 'mode');
    expect(modes.map((g) => [g.id, g.n, g.helped])).toEqual([
      ['puzzle', 3, 2],
      ['hop', 2, 1],
    ]);
  });

  it('the recent list: every answer with help, retries included, newest first', () => {
    const recent = recentHelp(log);
    expect(recent.map((a) => a.help)).toEqual(['hint1', 'shown', 'hint2', 'hint3', 'shown', 'hint1']);
    expect(recent[0]!.puzzle?.type).toBe('pattern');
    expect(recent[2]!.first).toBe(false);
    expect(countHelp(helpAnswers(log)).total).toBe(10);
  });
});

// ── the engine does not move ────────────────────────────────────────────────
describe('the engine and its replay are unchanged by the Help fields', () => {
  const play = (revealed: boolean): { states: unknown; records: ItemRecord[] } => {
    const clock = new SimClock();
    const e = new SessionEngine({ graph: GRAPH, model: glickoElo, now: clock.now }, { skills: {}, placement: { done: true, state: null } }, {
      sessionId: 'x', seed: 5, band: { id: 'B', targetP: 0.85, allowReading: true, maxReturns: 2 },
      mode: { id: 'hop', requires: ['numberLine'] }, plannedItems: 12, stretch: false, timed: false,
    });
    const records: ItemRecord[] = [];
    let i = 0;
    for (let p = e.next(); p; p = e.next()) {
      clock.advance(5000);
      const wrong = i % 3 === 1;
      const r = e.answer(p, {
        response: { kind: 'typed', raw: wrong ? '99999' : key(p.item.answer.value) }, latencyMs: 3000, hint: i % 4 === 2, hintTier: i % 4 === 2 ? 2 : 0,
        ...(wrong ? { revealed, ladderTier: revealed ? 1 : 0 } : {}), locale: 'en', conv: EN_CONV, input: 'typed',
      });
      records.push(r.record!);
      i++;
    }
    return { states: e.snapshot.skills, records };
  };

  it('"show me" and the ladder are logged only: states and replay are identical with or without them', () => {
    const a = play(false);
    const b = play(true);
    expect(b.states).toEqual(a.states);
    expect(b.records.some((r) => r.revealed)).toBe(true);
    const strip = (rs: ItemRecord[]): ItemRecord[] => rs.map(({ revealed: _r, ladder: _l, req: _q, ...r }) => r as ItemRecord);
    const ctx = { graph: GRAPH, model: glickoElo };
    expect(replay(ctx, b.records)).toEqual(replay(ctx, strip(a.records)));
  });
});
