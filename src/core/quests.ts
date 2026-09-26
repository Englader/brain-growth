/**
 * Daily quest: 2–3 small, VARIED objectives that steer behaviour we want
 * (review, the other language, variety, trying the harder path) rather than
 * volume. Evaluated with the same metric vocabulary as achievements.
 *
 * Risk acknowledged (DESIGN §1.9): an announced reward for a task is the
 * textbook overjustification set-up. Mitigations: the reward is an
 * unspecified cosmetic gift, quests never require accuracy, and the adult
 * dashboard reports play beyond quest completion (the free-choice measure);
 * if play stops exactly at completion, turn quests off with the flag.
 */
import { evalCondition } from './achievements/evaluator';
import type { EvalContext } from './achievements/types';
import { fnv1a } from './hash';
import { createRng } from './rng';
import type { BandId } from './types';

export interface QuestTemplate {
  id: string;
  bands: readonly BandId[] | 'all';
  metric: string;
  target: Record<BandId, number>;
}

export const QUEST_TEMPLATES: readonly QuestTemplate[] = [
  { id: 'quest.items', bands: 'all', metric: 'today.items', target: { A: 6, B: 12, C: 15 } },
  { id: 'quest.review', bands: 'all', metric: 'today.reviews', target: { A: 2, B: 3, C: 4 } },
  { id: 'quest.bilingual', bands: 'all', metric: 'today.locales', target: { A: 2, B: 2, C: 2 } },
  { id: 'quest.variety', bands: 'all', metric: 'today.skills', target: { A: 2, B: 3, C: 4 } },
  { id: 'quest.stretch', bands: ['B', 'C'], metric: 'today.stretch', target: { A: 1, B: 1, C: 1 } },
  { id: 'quest.spark', bands: 'all', metric: 'today.quickSpark', target: { A: 1, B: 1, C: 1 } },
];

export function questCount(band: BandId): number {
  return band === 'A' ? 2 : 3;
}

/** Deterministic per (profile, day): the same quests on every device, no server. */
export function questsForDay(pid: string, day: string, band: BandId): string[] {
  const rng = createRng(fnv1a(`${pid}|${day}`));
  const pool = QUEST_TEMPLATES.filter((q) => q.bands === 'all' || q.bands.includes(band));
  // Always include one effort quest so the set is completable on any day.
  const rest = rng.shuffle(pool.filter((q) => q.id !== 'quest.items')).slice(0, questCount(band) - 1);
  return ['quest.items', ...rest.map((q) => q.id)];
}

export function questProgress(id: string, ctx: EvalContext): { value: number; target: number; done: boolean } {
  const t = QUEST_TEMPLATES.find((q) => q.id === id);
  if (!t) return { value: 0, target: 1, done: false };
  const target = t.target[ctx.profile.band];
  const done = evalCondition({ metric: t.metric, gte: target }, ctx);
  const value = Number(ctx.memo.get(`m:${t.metric}:{}`) ?? 0);
  return { value: Math.min(value, target), target, done };
}
