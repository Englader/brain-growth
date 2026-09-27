/**
 * Workshop metrics. After a rectangle is solved the child may build other
 * rectangles that also fit the task; each new shape (4×6 and 6×4 count once)
 * is logged as a `workshop_shape` event, never as an item record, so an extra
 * shape is not read as a corrected mistake.
 */
import { EVENTS, type EventRecord } from '../../log/types';
import { registerMetric } from '../metrics';
import type { EvalContext } from '../types';

function shapeEvents(ctx: EvalContext): EventRecord[] {
  const k = 'ev:workshop_shape';
  if (!ctx.memo.has(k)) ctx.memo.set(k, ctx.log.filter((r): r is EventRecord => r.type === 'event' && r.name === EVENTS.WORKSHOP_SHAPE));
  return ctx.memo.get(k) as EventRecord[];
}

/** Extra rectangles found after a solve (each a different shape that also fits its task). */
registerMetric({
  id: 'workshop.otherShapes',
  kind: 'exploration',
  compute: (c) => shapeEvents(c).length,
});
