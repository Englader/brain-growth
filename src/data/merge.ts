/**
 * Merge rules used by backup import. Every rule is idempotent (importing the
 * same backup twice changes nothing) and monotone (a merge never loses
 * progress: streak days are a set union, counters take the max, first-unlock
 * timestamps take the min).
 */
import { mergeChallenges } from '../core/challenges';
import type { SkillState } from '../core/engine/model';
import type { Profile } from '../core/profile';
import { mergeStreaks } from '../core/streaks';
import type { SkillId } from '../core/types';
import { mergeWeekly } from '../core/weekly';

function mergeSkill(a: SkillState | undefined, b: SkillState | undefined): SkillState {
  if (!a) return b!;
  if (!b) return a;
  const winner = b.n > a.n || (b.n === a.n && b.lastSeen > a.lastSeen) ? b : a;
  const minDef = (x?: number, y?: number): number | undefined =>
    x === undefined ? y : y === undefined ? x : Math.min(x, y);
  const out: SkillState = { ...winner };
  const pa = minDef(a.proficientAt, b.proficientAt);
  const ma = minDef(a.masteredAt, b.masteredAt);
  if (pa !== undefined) out.proficientAt = pa;
  if (ma !== undefined) out.masteredAt = ma;
  return out;
}

export function mergeProfiles(a: Profile, b: Profile): Profile {
  const base = b.updatedAt > a.updatedAt ? b : a;
  const skills: Record<SkillId, SkillState> = {};
  for (const id of new Set([...Object.keys(a.skills), ...Object.keys(b.skills)])) {
    skills[id] = mergeSkill(a.skills[id], b.skills[id]);
  }
  const achievements: Profile['achievements'] = { ...a.achievements };
  for (const [id, v] of Object.entries(b.achievements)) {
    const cur = achievements[id];
    achievements[id] = cur ? { at: Math.min(cur.at, v.at), seen: cur.seen || v.seen } : v;
  }
  const stats = { ...a.stats };
  for (const k of Object.keys(b.stats) as Array<keyof Profile['stats']>) stats[k] = Math.max(a.stats[k] ?? 0, b.stats[k] ?? 0);

  const bestOf = (x: Profile['sprint']['best'], y: Profile['sprint']['best']): Profile['sprint']['best'] =>
    !x ? y : !y ? x : y.totalMs < x.totalMs ? y : x;
  const history = [...a.sprint.history, ...b.sprint.history]
    .filter((h, i, arr) => arr.findIndex((o) => o.at === h.at) === i)
    .sort((x, y) => x.at - y.at);

  return {
    ...base,
    createdAt: Math.min(a.createdAt, b.createdAt),
    skills,
    placement: a.placement.done ? a.placement : b.placement,
    streak: mergeStreaks(a.streak, b.streak),
    achievements,
    cosmetics: {
      owned: [...new Set([...a.cosmetics.owned, ...b.cosmetics.owned])],
      equipped: base.cosmetics.equipped,
    },
    stats,
    sprint: { best: bestOf(a.sprint.best, b.sprint.best), history },
    // Year bar (A-29): the later-updated copy's choice, else the other's; today's challenges: later day, ticks unioned.
    year: base.year ?? (base === a ? b.year : a.year) ?? null,
    challenges: mergeChallenges(a.challenges ?? null, b.challenges ?? null),
    // Feature merge rules (idempotent and monotone), each under its own anchor:
    // ── slot: frac ──
    // ── slot: hint ──
    // ── slot: pilot ──
    // ── slot: storage ──
    // ── slot: weekly ──
    weekly: mergeWeekly(a.weekly ?? null, b.weekly ?? null),
    // ── slot: target ──
    // ── slot: dice ──
    // ── slot: puzzle ──
    // Per puzzle type, the copy with more rated puzzles wins (then the later one): monotone and idempotent.
    puzzles: Object.fromEntries(
      [...new Set([...Object.keys(a.puzzles ?? {}), ...Object.keys(b.puzzles ?? {})])].map((type) => {
        const x = a.puzzles?.[type];
        const y = b.puzzles?.[type];
        return [type, !x ? y! : !y ? x : y.n > x.n || (y.n === x.n && y.lastSeen > x.lastSeen) ? y : x];
      }),
    ),
    // ── slot: workshop ──
    // ── slot: balance ──
    // ── slot: coord ──
    // ── slot: season ──
  };
}
