import type { BandId } from '../types';
import { getMetric } from './metrics';
import type { AchievementDef, Condition, EvalContext, MetricKind, Trigger } from './types';

export function evalCondition(cond: Condition, ctx: EvalContext): boolean {
  if ('all' in cond) return cond.all.every((c) => evalCondition(c, ctx));
  if ('any' in cond) return cond.any.some((c) => evalCondition(c, ctx));
  const m = getMetric(cond.metric);
  if (!m) return false;
  const key = `m:${cond.metric}:${JSON.stringify(cond.params ?? {})}`;
  let v = ctx.memo.get(key) as number | undefined;
  if (v === undefined) {
    v = m.compute(ctx, cond.params ?? {});
    ctx.memo.set(key, v);
  }
  if (cond.gte !== undefined && !(v >= cond.gte)) return false;
  if (cond.lte !== undefined && !(v <= cond.lte)) return false;
  if (cond.eq !== undefined && v !== cond.eq) return false;
  return true;
}

export function appliesToBand(def: AchievementDef, band: BandId): boolean {
  return def.bands === 'all' || def.bands.includes(band);
}

/** Newly satisfied achievements for this trigger (already-unlocked ones are skipped). */
export function evaluateAchievements(defs: readonly AchievementDef[], ctx: EvalContext, trigger: Trigger): string[] {
  const out: string[] = [];
  for (const d of defs) {
    if (ctx.profile.achievements[d.id]) continue;
    if (!d.on.includes(trigger)) continue;
    if (!appliesToBand(d, ctx.profile.band)) continue;
    if (evalCondition(d.when, ctx)) out.push(d.id);
  }
  return out;
}

function metricKinds(cond: Condition, acc: Set<MetricKind | 'unknown'>): Set<MetricKind | 'unknown'> {
  if ('all' in cond) cond.all.forEach((c) => metricKinds(c, acc));
  else if ('any' in cond) cond.any.forEach((c) => metricKinds(c, acc));
  else acc.add(getMetric(cond.metric)?.kind ?? 'unknown');
  return acc;
}

/** Static checks on the catalogue; run in CI. */
export function validateAchievements(defs: readonly AchievementDef[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const d of defs) {
    if (ids.has(d.id)) errors.push(`${d.id}: duplicate id`);
    ids.add(d.id);
    const kinds = metricKinds(d.when, new Set());
    if (kinds.has('unknown')) errors.push(`${d.id}: unknown metric`);
    if ([...kinds].every((k) => k === 'correctness')) {
      errors.push(`${d.id}: rewards raw correctness only (overjustification guard)`);
    }
    if (d.category === 'discovery' && !d.secret) errors.push(`${d.id}: discovery achievements must be secret`);
  }
  return errors;
}
