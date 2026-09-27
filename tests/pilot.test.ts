/**
 * Pilot instrumentation (DESIGN §4 step 2, §5.2 I-1): the pilot readout
 * metrics from synthetic logs, the session record's new tail fields through
 * the codec (and old records without them), and the session actions filling
 * them in.
 */
import { describe, expect, it } from 'vitest';
import '../src/modes';
import { calibration, calibrationBias, exitsAfterError, feedbackTime, hintTier, hintUsage, strategyA } from '../src/adult/analytics';
import { finishSession, recordAnswer, startSessionFor } from '../src/app/actions';
import { saveProfile } from '../src/app/persist';
import { logFeedback } from '../src/app/pilotActions';
import { repo } from '../src/app/services';
import { setState } from '../src/app/store';
import { decodeRecord, encodeRecord } from '../src/core/log/codec';
import type { EventRecord, ItemRecord, LogRecord, SessionRecord } from '../src/core/log/types';
import { EVENTS } from '../src/core/log/types';
import { exitIndex, lastAnswerCorrect } from '../src/core/pilot/exits';
import { createProfile, type Profile } from '../src/core/profile';
import { key, toNumber } from '../src/core/rational';

const T = Date.UTC(2026, 8, 20, 15);
let seq = 0;

const item = (over: Partial<ItemRecord> = {}): ItemRecord => {
  seq++;
  return {
    type: 'item', ts: T + seq * 1000, sid: 's1', key: `k${seq}`, skill: 'as.add.20', gen: 'addsub', genV: 1, seed: seq,
    level: 0.5, diff: 0, p: 0.8, mu: 1, s2: 0.4, correct: true, attempt: 1, latency: 3000, hint: false,
    answer: '13', expected: '13', mis: null, mode: 'hop', band: 'B', locale: 'mk', source: 'frontier',
    timed: false, input: 'typed', hops: null, alt: false, ...over,
  };
};
const end = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  type: 'session', ts: T + 100_000, sid: 's1', phase: 'end', mode: 'hop', band: 'B', locale: 'mk', opts: {},
  items: 5, firstCorrect: 4, durationMs: 300_000, completed: true, lastCorrect: true, exitIndex: null, ...over,
});
const ev = (name: string, data: Record<string, unknown> | null, sid: string | null = 's1'): EventRecord => ({ type: 'event', ts: T, sid, name, data });

describe('pilot readout metrics (synthetic logs)', () => {
  it('exitsAfterError: early exits after ≥ 1 answer, how many right after a wrong answer, median exit point', () => {
    const log: LogRecord[] = [
      end({ sid: 'a', completed: true, lastCorrect: false }), // ran to the end: not an exit
      end({ sid: 'b', completed: false, lastCorrect: false, exitIndex: 3 }),
      end({ sid: 'c', completed: false, lastCorrect: true, exitIndex: 7 }),
      end({ sid: 'd', completed: false, items: 0, lastCorrect: null, exitIndex: 1 }), // quit before answering
      // Written before the pilot fields existed: the last item of that session decides.
      item({ sid: 'e', correct: true }),
      item({ sid: 'e', correct: false }),
      end({ sid: 'e', completed: false, lastCorrect: undefined, exitIndex: undefined }),
    ];
    expect(exitsAfterError(log)).toEqual({ exits: 3, afterError: 2, share: 2 / 3, medianIndex: 5 });
    expect(exitsAfterError([])).toEqual({ exits: 0, afterError: 0, share: null, medianIndex: null });
  });

  it('hintUsage: untimed Band B/C first attempts; the single hint counts as tier 2 until the ladder logs tiers', () => {
    const log: LogRecord[] = [
      item({ hint: true }),
      item({ hint: false }),
      item({ hint: false }),
      item({ hint: true, band: 'C' }),
      item({ hint: true, attempt: 2 }), // retries are not counted
      item({ hint: true, timed: true }), // Sprint
      item({ band: 'A', input: 'tap' }), // Band A has no hint button
    ];
    expect(hintTier(item({ hint: true }))).toBe(2);
    expect(hintTier(item())).toBe(0);
    expect(hintUsage(log)).toEqual({ n: 4, used: 2, share: 0.5, byTier: [2, 0, 2, 0] });
    expect(hintUsage([item({ band: 'A' })]).share).toBeNull();
  });

  it('feedbackTime: median of the logged feedback events, ignoring other events and malformed data', () => {
    const log: LogRecord[] = [
      ev(EVENTS.FEEDBACK, { key: '1', attempt: 1, ms: 4000 }),
      ev(EVENTS.FEEDBACK, { key: '2', attempt: 1, ms: 9000 }),
      ev(EVENTS.FEEDBACK, { key: '2', attempt: 2, ms: 2000 }),
      ev(EVENTS.FEEDBACK, { key: '3', attempt: 1, ms: 'soon' }),
      ev(EVENTS.FEEDBACK, null),
      ev(EVENTS.DROP, { ms: 99_999 }),
      item(),
    ];
    expect(feedbackTime(log)).toEqual({ n: 3, medianMs: 4000 });
    expect(feedbackTime([])).toEqual({ n: 0, medianMs: null });
  });

  it('strategyA: hop buttons vs direct taps per Band A skill, latency trend, counting → retrieval reading', () => {
    const a = (skill: string, input: 'hops' | 'tap', latency: number, correct = true): ItemRecord =>
      item({ skill, band: 'A', input, hops: input === 'hops' ? 3 : 0, latency, correct });
    const log: LogRecord[] = [
      // Moving to retrieval: counts with hops early, taps directly (and faster) later.
      a('as.add.10', 'hops', 9000), a('as.add.10', 'hops', 8000), a('as.add.10', 'hops', 7000), a('as.add.10', 'tap', 6000, false),
      a('as.add.10', 'tap', 4000), a('as.add.10', 'tap', 3000), a('as.add.10', 'tap', 3500), a('as.add.10', 'tap', 2500),
      // Still counting.
      ...Array.from({ length: 6 }, () => a('num.count.10', 'hops', 6000)),
      // Mixed.
      a('num.locate.20', 'hops', 5000), a('num.locate.20', 'tap', 5000), a('num.locate.20', 'hops', 5000),
      a('num.locate.20', 'tap', 5000), a('num.locate.20', 'hops', 5000), a('num.locate.20', 'tap', 4000),
      // Too few for a reading.
      a('as.sub.10', 'hops', 5000), a('as.sub.10', 'tap', 4000), a('as.sub.10', 'tap', 3000),
      // Not Band A pad answers: ignored.
      item({ skill: 'as.add.10', band: 'B', input: 'typed' }),
      item({ skill: 'as.add.10', band: 'A', input: 'choice' }),
      item({ skill: 'as.add.10', band: 'A', input: 'tap', attempt: 2 }),
    ];
    const rows = new Map(strategyA(log).map((r) => [r.skill, r]));
    expect(rows.get('as.add.10')).toEqual({
      skill: 'as.add.10', n: 8, hops: 3, taps: 5, hopShare: 3 / 8, latency: { early: 8000, late: 3250 }, stage: 'retrieval',
    });
    expect(rows.get('num.count.10')).toMatchObject({ n: 6, hopShare: 1, stage: 'counting', latency: { early: 6000, late: 6000 } });
    expect(rows.get('num.locate.20')).toMatchObject({ n: 6, stage: 'mixed' });
    expect(rows.get('as.sub.10')).toMatchObject({ n: 3, hops: 1, taps: 2, stage: null, latency: { early: null, late: null } });
    expect(strategyA(log)[0]!.skill).toBe('as.add.10'); // most answers first
  });

  it('strategyA: direct taps that get slower are not read as retrieval', () => {
    const log = [9000, 9000, 9000, 1000, 1000, 1000].map((latency, i) =>
      item({ skill: 'as.add.10', band: 'A', input: i < 2 ? 'hops' : 'tap', latency: 12_000 - latency }),
    );
    expect(strategyA(log)[0]).toMatchObject({ stage: 'mixed', latency: { early: 3000, late: 11_000 } });
  });

  it('calibrationBias: top skills by |observed − predicted| with ≥ 15 first tries; the calibration tab flags > 15 points', () => {
    const many = (skill: string, n: number, p: number, right: number): ItemRecord[] =>
      Array.from({ length: n }, (_, i) => item({ skill, p, correct: i < right }));
    const log: LogRecord[] = [
      ...many('as.add.20', 20, 0.8, 10), // −30 points
      ...many('as.sub.20', 20, 0.8, 18), // +10
      ...many('md.mult.facts', 20, 0.5, 15), // +25
      ...many('pv.place.100', 20, 0.9, 17), // −5
      ...many('num.line.100', 10, 0.9, 0), // too few
      ...many('as.addsub.100', 20, 0.9, 0).map((r) => ({ ...r, source: 'placement' as const })), // placement excluded
    ];
    const top = calibrationBias(log);
    expect(top.map((b) => b.skill)).toEqual(['as.add.20', 'md.mult.facts', 'as.sub.20']);
    expect(top[0]).toMatchObject({ n: 20, o: 0.5 });
    expect(top[0]!.bias).toBeCloseTo(-0.3);
    expect(calibration(log).flagged.map((f) => f.skill)).toEqual(['as.add.20', 'md.mult.facts']);
  });
});

describe('session record pilot fields', () => {
  it('round-trip through the codec (appended at the end of SESSION_FIELDS_V1, no version bump)', () => {
    for (const r of [end({ completed: false, lastCorrect: false, exitIndex: 4 }), end({ lastCorrect: true, exitIndex: null }), end({ lastCorrect: null, exitIndex: null })]) {
      const enc = encodeRecord(r);
      expect(enc[0]).toBe('s');
      expect(enc[1]).toBe(1);
      expect(decodeRecord(JSON.parse(JSON.stringify(enc)))).toEqual(r);
    }
    expect(encodeRecord(end({ completed: false, lastCorrect: false, exitIndex: 4 })).slice(-3)).toEqual([0, 0, 4]);
  });

  it('old session records (written before the fields existed) decode with null', () => {
    const old = ['s', 1, T, 's9', 'end', 'hop', 'B', 'mk', {}, 10, 8, 400_000, 0];
    const r = decodeRecord(old);
    expect(r).toMatchObject({ type: 'session', sid: 's9', completed: false, items: 10 });
    expect(r).toHaveProperty('lastCorrect', null);
    expect(r).toHaveProperty('exitIndex', null);
    // A record from before the fields, missing from memory as `undefined`, encodes to the same nulls.
    expect(encodeRecord(end({ lastCorrect: undefined, exitIndex: undefined })).slice(-2)).toEqual([null, null]);
  });

  it('lastAnswerCorrect reads only this session, back to its start; exitIndex only for early exits', () => {
    const start: SessionRecord = { ...end({ sid: 's2' }), phase: 'start', items: null, firstCorrect: null, durationMs: null, completed: null };
    const log: LogRecord[] = [item({ sid: 's2', correct: false }), start, item({ sid: 's1', correct: false }), ev(EVENTS.DROP, {}, 's2')];
    expect(lastAnswerCorrect(log, 's2')).toBeNull();
    expect(lastAnswerCorrect([...log, item({ sid: 's2', correct: true }), item({ sid: 's1', correct: true })], 's2')).toBe(true);
    expect(lastAnswerCorrect(log, 's1')).toBe(false);
    expect(exitIndex(true, 12)).toBeNull();
    expect(exitIndex(false, 3)).toBe(3);
  });
});

describe('session actions fill the pilot fields; feedback time is logged', () => {
  const kid = (name: string): Profile => saveProfile(createProfile({ name, age: 9, locale: 'mk', avatar: 'color.green' }, Date.now()));

  const play = (p: Profile, answers: boolean[], completed: boolean): SessionRecord => {
    let s = startSessionFor(p, 'hop')!;
    let prof = p;
    for (const right of answers) {
      const presented = s.engine.next()!;
      const v = toNumber(presented.item.answer.value);
      const raw = right ? key(presented.item.answer.value) : String(v + 1000);
      const r = recordAnswer(prof, s, presented, { kind: 'typed', raw }, { latencyMs: 2500, hint: false, input: 'typed', hops: 0 });
      expect(r.res.grade.correct).toBe(right);
      prof = r.profile;
      s = r.session;
    }
    finishSession(prof, s, completed);
    const ends = repo.readKnownLog(p.id).filter((r): r is SessionRecord => r.type === 'session' && r.phase === 'end');
    return ends[ends.length - 1]!;
  };

  it('an exit right after a wrong answer, an exit after a right one, a finished session, a quit before answering', () => {
    repo.init();
    const p = kid('Марко');
    setState({ profile: p, profiles: [p], session: null, meta: repo.meta() });
    expect(play(p, [true, false], false)).toMatchObject({ completed: false, items: 2, lastCorrect: false, exitIndex: 2 });
    expect(play(p, [false, true, true], false)).toMatchObject({ lastCorrect: true, exitIndex: 3 });
    expect(play(p, [true], true)).toMatchObject({ completed: true, lastCorrect: true, exitIndex: null });
    expect(play(p, [], false)).toMatchObject({ items: 0, lastCorrect: null, exitIndex: 0 });
    const starts = repo.readKnownLog(p.id).filter((r) => r.type === 'session' && r.phase === 'start');
    expect(starts.every((r) => r.type === 'session' && r.lastCorrect === null && r.exitIndex === null)).toBe(true);
    expect(exitsAfterError(repo.readKnownLog(p.id))).toMatchObject({ exits: 2, afterError: 1, share: 0.5 });
  });

  it('logFeedback appends { key, attempt, ms } under the session id', () => {
    repo.init();
    const p = kid('Ана');
    logFeedback(p.id, 's7', '3', 2, 5321.6);
    const e = repo.readKnownLog(p.id).find((r): r is EventRecord => r.type === 'event' && r.name === EVENTS.FEEDBACK);
    expect(e).toMatchObject({ sid: 's7', data: { key: '3', attempt: 2, ms: 5322 } });
    expect(feedbackTime(repo.readKnownLog(p.id))).toEqual({ n: 1, medianMs: 5322 });
  });
});
