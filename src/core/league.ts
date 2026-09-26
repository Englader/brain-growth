/**
 * Family league: head-to-head across ages without a predetermined winner.
 *
 * Every component is normalised to the child's OWN band and capped, so a
 * 6-year-old doing 3 minutes a day and a 13-year-old doing 12 score the same
 * for the same habit. Nothing here measures raw difficulty or raw accuracy.
 *
 *   consistency 35  active days / 5
 *   effort      30  Σ_days min(1, minutes / band target) / 5
 *   growth      20  skill promotions (→proficient, →mastered) / 2
 *   grit        15  (mistakes fixed on the return + stretch items / 3) / 8
 *   wildcard    10  this week's luck category — same for everyone, picked by
 *                   hashing the week id, so devices agree with no server
 *
 * Shared state: a signed-free "rival card" in the URL fragment (never sent to
 * any server), shared via the OS share sheet. See DESIGN §1.10.
 */
import { fnv1a, fromBase64Url, hashHex, toBase64Url } from './hash';
import type { LogRecord } from './log/types';
import { EVENTS } from './log/types';
import { dayKey, weekKey } from './time';
import type { BandId } from './types';

export const WILDCARDS = ['bothLanguages', 'reviewer', 'variety', 'weekend', 'quickSpark'] as const;
export type WildcardId = (typeof WILDCARDS)[number];

export function wildcardForWeek(week: string): WildcardId {
  return WILDCARDS[fnv1a(`wildcard:${week}`) % WILDCARDS.length]!;
}

export interface LeagueParts {
  consistency: number;
  effort: number;
  growth: number;
  grit: number;
  wildcard: number;
}

export interface WeeklyEffort {
  week: string;
  activeDays: number;
  effortDays: number;
  growthSteps: number;
  grit: number;
  wildcard: { id: WildcardId; met: boolean };
  parts: LeagueParts;
  total: number;
}

const cap = (x: number): number => Math.max(0, Math.min(1, x));

export function weeklyEffort(records: readonly LogRecord[], week: string, targetMinutes: number): WeeklyEffort {
  const inWeek = records.filter((r) => weekKey(r.ts) === week);
  const itemDays = new Map<string, number>();
  const minutesByDay = new Map<string, number>();
  const locales = new Set<string>();
  const skills = new Set<string>();
  let reviews = 0;
  let fixed = 0;
  let stretchItems = 0;
  let growthSteps = 0;
  let weekend = false;
  let quickSpark = false;
  const stretchSessions = new Set<string>();

  for (const r of inWeek) {
    if (r.type === 'session' && r.phase === 'start' && r.opts.stretch) stretchSessions.add(r.sid);
  }
  for (const r of inWeek) {
    const d = dayKey(r.ts);
    if (r.type === 'item') {
      itemDays.set(d, (itemDays.get(d) ?? 0) + 1);
      locales.add(r.locale);
      skills.add(r.skill);
      if (r.source === 'review') reviews++;
      if (r.attempt > 1 && r.correct) fixed++;
      if (stretchSessions.has(r.sid) && r.attempt === 1) stretchItems++;
      const dow = new Date(r.ts).getDay();
      if (dow === 0 || dow === 6) weekend = true;
    } else if (r.type === 'session' && r.phase === 'end') {
      minutesByDay.set(d, (minutesByDay.get(d) ?? 0) + (r.durationMs ?? 0) / 60_000);
      if (r.opts.quick && r.completed) quickSpark = true;
    } else if (r.type === 'event' && r.name === EVENTS.STATUS_CHANGE) {
      const to = r.data?.to;
      if (to === 'proficient' || to === 'mastered') growthSteps++;
    }
  }
  const activeDays = [...itemDays.values()].filter((n) => n >= 3).length;
  const effortDays = [...minutesByDay.values()].reduce((s, m) => s + cap(m / targetMinutes), 0);
  const grit = fixed + stretchItems / 3;
  const wid = wildcardForWeek(week);
  const met: Record<WildcardId, boolean> = {
    bothLanguages: locales.size >= 2,
    reviewer: reviews >= 5,
    variety: skills.size >= 4,
    weekend,
    quickSpark,
  };
  const parts: LeagueParts = {
    consistency: Math.round(35 * cap(activeDays / 5)),
    effort: Math.round(30 * cap(effortDays / 5)),
    growth: Math.round(20 * cap(growthSteps / 2)),
    grit: Math.round(15 * cap(grit / 8)),
    wildcard: met[wid] ? 10 : 0,
  };
  return {
    week,
    activeDays,
    effortDays,
    growthSteps,
    grit,
    wildcard: { id: wid, met: met[wid] },
    parts,
    total: parts.consistency + parts.effort + parts.growth + parts.grit + parts.wildcard,
  };
}

// ── Rival cards: URL-fragment shared state ──────────────────────────────────

export interface RivalCard {
  v: 1;
  pid: string;
  name: string;
  band: BandId;
  avatar: string;
  week: string;
  total: number;
  parts: LeagueParts;
  streak: number;
  updatedAt: number;
}

export function encodeRivalCard(card: RivalCard): string {
  const json = JSON.stringify(card);
  return `${toBase64Url(json)}.${hashHex(json)}`;
}

export function decodeRivalCard(payload: string): RivalCard | null {
  try {
    const [body, sum] = payload.split('.');
    if (!body || !sum) return null;
    const json = fromBase64Url(body);
    if (hashHex(json) !== sum) return null; // truncated or edited link
    const c = JSON.parse(json) as RivalCard;
    if (c.v !== 1 || typeof c.pid !== 'string' || typeof c.total !== 'number' || !/^\d{4}-W\d{2}$/.test(c.week)) return null;
    return { ...c, name: String(c.name).slice(0, 24) };
  } catch {
    return null;
  }
}

export function mergeRivals(a: Record<string, RivalCard>, b: Record<string, RivalCard>): Record<string, RivalCard> {
  const out = { ...a };
  for (const [pid, card] of Object.entries(b)) if (!out[pid] || out[pid]!.updatedAt < card.updatedAt) out[pid] = card;
  return out;
}
