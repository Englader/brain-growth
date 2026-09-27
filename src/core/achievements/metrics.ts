/**
 * Metric vocabulary for achievements and daily quests. Each metric is a pure
 * function of (profile, recent log). Register new ones with registerMetric.
 */
import { BAND_IDS } from '../types';
import type { ItemRecord, LogRecord, SessionRecord } from '../log/types';
import { EVENTS } from '../log/types';
import { currentStreak, daysAway } from '../streaks';
import { dayKey, hourOf, addDays } from '../time';
import type { EvalContext, MetricDef } from './types';

const registry = new Map<string, MetricDef>();

export function registerMetric(def: MetricDef): void {
  if (registry.has(def.id)) throw new Error(`metric ${def.id} registered twice`);
  registry.set(def.id, def);
}

export function getMetric(id: string): MetricDef | undefined {
  return registry.get(id);
}

export function allMetrics(): MetricDef[] {
  return [...registry.values()];
}

// ── shared, memoised views of the log ─────────────────────────────────────
function memo<T>(ctx: EvalContext, key: string, f: () => T): T {
  if (!ctx.memo.has(key)) ctx.memo.set(key, f());
  return ctx.memo.get(key) as T;
}

const items = (ctx: EvalContext): ItemRecord[] =>
  memo(ctx, 'items', () => ctx.log.filter((r): r is ItemRecord => r.type === 'item'));

const sessionEnds = (ctx: EvalContext): SessionRecord[] =>
  memo(ctx, 'sessEnd', () => ctx.log.filter((r): r is SessionRecord => r.type === 'session' && r.phase === 'end'));

/** Modes the child has opened a session in (session start records, so standalone modes without items count too). */
const modesTried = (ctx: EvalContext): Set<string> =>
  memo(ctx, 'modesTried', () => new Set(ctx.log.filter((r): r is SessionRecord => r.type === 'session' && r.phase === 'start').map((r) => r.mode)));

const events = (ctx: EvalContext, name: string): LogRecord[] =>
  memo(ctx, `ev:${name}`, () => ctx.log.filter((r) => r.type === 'event' && r.name === name));

/** First-attempt accuracy per session id. */
const sessionAccuracy = (ctx: EvalContext): Map<string, { n: number; c: number; day: string }> =>
  memo(ctx, 'sessAcc', () => {
    const m = new Map<string, { n: number; c: number; day: string }>();
    for (const r of items(ctx)) {
      if (r.attempt !== 1 || r.timed) continue;
      const e = m.get(r.sid) ?? { n: 0, c: 0, day: dayKey(r.ts) };
      e.n++;
      e.c += r.correct ? 1 : 0;
      m.set(r.sid, e);
    }
    return m;
  });

const todayItems = (ctx: EvalContext): ItemRecord[] =>
  memo(ctx, 'todayItems', () => items(ctx).filter((r) => dayKey(r.ts) === ctx.today));

const isPalindrome = (s: string): boolean => /^\d{3,}$/.test(s) && s === [...s].reverse().join('');

// ── streak & persistence ──────────────────────────────────────────────────
registerMetric({ id: 'streak.current', kind: 'streak', compute: (c) => currentStreak(c.profile.streak, c.today) });
registerMetric({ id: 'streak.longest', kind: 'streak', compute: (c) => Math.max(c.profile.streak.longest, currentStreak(c.profile.streak, c.today)) });
registerMetric({ id: 'days.active', kind: 'effort', compute: (c) => c.profile.streak.activeDays.length });
registerMetric({
  id: 'days.away',
  kind: 'effort',
  compute: (c) => (c.profile.streak.activeDays.includes(c.today) ? daysAway(c.profile.streak, c.today) ?? 0 : 0),
});
registerMetric({ id: 'items.total', kind: 'effort', compute: (c) => c.profile.stats.items });
registerMetric({ id: 'sessions.total', kind: 'effort', compute: (c) => c.profile.stats.sessions });
registerMetric({
  id: 'session.afterHardDay',
  kind: 'resilience',
  compute: (c) => {
    if (!c.profile.streak.activeDays.includes(c.today)) return 0;
    const prev = c.profile.streak.activeDays.filter((d) => d < c.today).pop();
    if (!prev) return 0;
    for (const s of sessionAccuracy(c).values()) if (s.day === prev && s.n >= 5 && s.c / s.n < 0.6) return 1;
    return 0;
  },
});

// ── mastery (graph-based, endogenous) ─────────────────────────────────────
registerMetric({
  id: 'skills.mastered',
  kind: 'mastery',
  compute: (c, p) =>
    Object.entries(c.profile.skills).filter(
      ([id, s]) => s.masteredAt !== undefined && (!p.strand || c.graph.get(id).strand === p.strand),
    ).length,
});
registerMetric({
  id: 'skill.mastered',
  kind: 'mastery',
  compute: (c, p) => (c.profile.skills[String(p.skill)]?.masteredAt !== undefined ? 1 : 0),
});
registerMetric({
  id: 'skills.masteredAboveBand',
  kind: 'mastery',
  compute: (c) => {
    const bandIdx = BAND_IDS.indexOf(c.profile.band);
    return Object.entries(c.profile.skills).filter(
      ([id, s]) => s.masteredAt !== undefined && c.graph.has(id) && BAND_IDS.indexOf(c.graph.get(id).band) > bandIdx,
    ).length;
  },
});
registerMetric({
  id: 'skills.proficient',
  kind: 'mastery',
  compute: (c) => Object.values(c.profile.skills).filter((s) => s.proficientAt !== undefined).length,
});

// ── resilience: being wrong is survivable, and fixing it is rewarded ─────
registerMetric({ id: 'items.fixed', kind: 'resilience', compute: (c) => items(c).filter((r) => r.attempt > 1 && r.correct).length });
registerMetric({
  id: 'item.maxWrongThenRight',
  kind: 'resilience',
  compute: (c) => Math.max(0, ...items(c).filter((r) => r.attempt > 1 && r.correct).map((r) => r.attempt - 1)),
});
registerMetric({
  id: 'session.struggledAndFinished',
  kind: 'resilience',
  compute: (c) => {
    const acc = sessionAccuracy(c);
    return sessionEnds(c).some((s) => s.completed && (acc.get(s.sid)?.n ?? 0) >= 5 && acc.get(s.sid)!.c / acc.get(s.sid)!.n < 0.65) ? 1 : 0;
  },
});
registerMetric({
  id: 'skill.returnedAfterStruggle',
  kind: 'resilience',
  compute: (c) => {
    // A skill with a day of ≥3 first attempts under 50%, practised again on a later day.
    const byDaySkill = new Map<string, { n: number; c: number }>();
    for (const r of items(c)) {
      if (r.attempt !== 1) continue;
      const k = `${r.skill}|${dayKey(r.ts)}`;
      const e = byDaySkill.get(k) ?? { n: 0, c: 0 };
      e.n++;
      e.c += r.correct ? 1 : 0;
      byDaySkill.set(k, e);
    }
    for (const [k, v] of byDaySkill) {
      if (v.n < 3 || v.c / v.n >= 0.5) continue;
      const [skill, day] = k.split('|') as [string, string];
      for (const k2 of byDaySkill.keys()) {
        const [s2, d2] = k2.split('|') as [string, string];
        if (s2 === skill && d2 > day) return 1;
      }
    }
    return 0;
  },
});

// ── exploration ───────────────────────────────────────────────────────────
registerMetric({ id: 'locales.used', kind: 'exploration', compute: (c) => new Set(items(c).map((r) => r.locale)).size });
registerMetric({
  id: 'locale.switchedMidSession',
  kind: 'exploration',
  compute: (c) => events(c, EVENTS.LOCALE_SWITCH).filter((e) => e.type === 'event' && e.data?.mid === true).length,
});
registerMetric({ id: 'modes.tried', kind: 'exploration', compute: (c) => modesTried(c).size });
registerMetric({
  id: 'modes.triedAll',
  kind: 'exploration',
  compute: (c) => (modesTried(c).size >= c.modesAvailable ? 1 : 0),
});
registerMetric({
  id: 'stretch.items',
  kind: 'exploration',
  compute: (c) => {
    const stretch = new Set(c.log.filter((r) => r.type === 'session' && r.phase === 'start' && r.opts.stretch).map((r) => (r as SessionRecord).sid));
    return items(c).filter((r) => stretch.has(r.sid) && r.attempt === 1).length;
  },
});
registerMetric({
  id: 'strands.practised',
  kind: 'exploration',
  compute: (c) => new Set(items(c).filter((r) => c.graph.has(r.skill)).map((r) => c.graph.get(r.skill).strand)).size,
});

// ── discovery (secret) ────────────────────────────────────────────────────
registerMetric({ id: 'stats.petTaps', kind: 'discovery', compute: (c) => c.profile.stats.petTaps });
registerMetric({ id: 'stats.hops', kind: 'discovery', compute: (c) => c.profile.stats.hops });
registerMetric({ id: 'stats.localeSwitches', kind: 'discovery', compute: (c) => c.profile.stats.localeSwitches });
registerMetric({ id: 'answer.palindrome', kind: 'discovery', compute: (c) => items(c).filter((r) => r.correct && isPalindrome(r.answer)).length });
registerMetric({ id: 'answer.value', kind: 'discovery', compute: (c, p) => items(c).filter((r) => r.correct && r.answer === String(p.v)).length });
registerMetric({
  id: 'answer.bullseye',
  kind: 'discovery',
  compute: (c) => items(c).filter((r) => r.correct && r.gen === 'locate' && r.answer === r.expected && Number(r.expected) >= 100).length,
});
registerMetric({
  id: 'answer.sameThreeInARow',
  kind: 'discovery',
  compute: (c) => {
    const its = items(c).filter((r) => r.correct);
    for (let i = 2; i < its.length; i++) {
      const [a, b, d] = [its[i - 2]!, its[i - 1]!, its[i]!];
      if (a.sid === d.sid && a.answer === b.answer && b.answer === d.answer && a.key !== b.key && b.key !== d.key) return 1;
    }
    return 0;
  },
});
registerMetric({
  id: 'time.earlyBird',
  kind: 'discovery',
  compute: (c) => c.log.filter((r) => r.type === 'session' && r.phase === 'start' && hourOf(r.ts) >= 5 && hourOf(r.ts) < 7).length,
});
registerMetric({
  id: 'weekend.both',
  kind: 'discovery',
  compute: (c) => {
    const days = new Set(c.profile.streak.activeDays);
    for (const d of days) {
      const dow = new Date(`${d}T12:00:00`).getDay();
      if (dow === 6 && days.has(addDays(d, 1))) return 1;
    }
    return 0;
  },
});

// ── correctness (exists so the guard has something to guard against) ─────
registerMetric({
  id: 'accuracy.session',
  kind: 'correctness',
  compute: (c) => {
    const s = c.sessionId ? sessionAccuracy(c).get(c.sessionId) : undefined;
    return s && s.n ? s.c / s.n : 0;
  },
});

// ── today-window metrics (daily quests) ───────────────────────────────────
registerMetric({ id: 'today.items', kind: 'effort', compute: (c) => todayItems(c).filter((r) => r.attempt === 1).length });
registerMetric({ id: 'today.reviews', kind: 'effort', compute: (c) => todayItems(c).filter((r) => r.source === 'review' || r.source === 'warmup').length });
registerMetric({ id: 'today.locales', kind: 'exploration', compute: (c) => new Set(todayItems(c).map((r) => r.locale)).size });
registerMetric({ id: 'today.skills', kind: 'exploration', compute: (c) => new Set(todayItems(c).map((r) => r.skill)).size });
registerMetric({
  id: 'today.stretch',
  kind: 'exploration',
  compute: (c) => (c.log.some((r) => r.type === 'session' && r.phase === 'start' && r.opts.stretch && dayKey(r.ts) === c.today) ? 1 : 0),
});
registerMetric({
  id: 'today.quickSpark',
  kind: 'effort',
  compute: (c) => (sessionEnds(c).some((r) => r.opts.quick && r.completed && dayKey(r.ts) === c.today) ? 1 : 0),
});

// ── daily quest equivalence (DESIGN A-29) ─────────────────────────────────
// Days with a completed daily quest: a quest's own `quest_done`, or today's challenges completed
// (logged as `quest_done` with via 'challenges'), so an achievement over quests stays reachable.
registerMetric({
  id: 'quests.completed',
  kind: 'effort',
  compute: (c) => new Set(events(c, EVENTS.QUEST_DONE).map((r) => dayKey(r.ts))).size,
});
