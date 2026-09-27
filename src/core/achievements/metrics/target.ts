/**
 * Target ("Make it") metrics. Extra ways are logged as `target_way` events
 * (never as item records, so a second solution is not read as a fixed
 * mistake); each carries `n`, the number of distinct ways the child has found
 * for that deal, the first solve included.
 */
import { EVENTS, type EventRecord } from '../../log/types';
import { registerMetric } from '../metrics';
import type { EvalContext } from '../types';

function wayEvents(ctx: EvalContext): EventRecord[] {
  const k = 'ev:target_way';
  if (!ctx.memo.has(k)) ctx.memo.set(k, ctx.log.filter((r): r is EventRecord => r.type === 'event' && r.name === EVENTS.TARGET_WAY));
  return ctx.memo.get(k) as EventRecord[];
}

/** Most distinct ways found for a single deal (0 when no extra way was ever found). */
registerMetric({
  id: 'target.ways',
  kind: 'exploration',
  compute: (c) => wayEvents(c).reduce((m, e) => Math.max(m, Number(e.data?.n) || 0), 0),
});
