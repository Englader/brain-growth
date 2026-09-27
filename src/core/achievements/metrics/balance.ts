/**
 * Balance metrics. `balance.recovered` is resilience, not correctness: it
 * counts Balance equations solved AFTER the scale refused a move (the
 * transcript in the item's `answer` carries a `!` for every refused move).
 */
import type { ItemRecord } from '../../log/types';
import { registerMetric } from '../metrics';

registerMetric({
  id: 'balance.recovered',
  kind: 'resilience',
  compute: (c) => c.log.filter((r): r is ItemRecord => r.type === 'item' && r.mode === 'balance' && r.correct && r.answer.includes('!')).length,
});
