/**
 * Coordinate-plane metrics. `coord.quadrants` is exploration: how many of the
 * four quadrants the child has placed or read a point in (right or wrong;
 * points on an axis belong to none). The item's `answer` is the given point,
 * "x,y".
 */
import { parsePointRepr, quadrant } from '../../coord/point';
import { registerMetric } from '../metrics';

registerMetric({
  id: 'coord.quadrants',
  kind: 'exploration',
  compute: (c) => {
    const seen = new Set<number>();
    for (const r of c.log) {
      if (r.type !== 'item' || r.mode !== 'coord') continue;
      const p = parsePointRepr(r.answer);
      const q = p ? quadrant(p) : 0;
      if (q) seen.add(q);
    }
    return seen.size;
  },
});
