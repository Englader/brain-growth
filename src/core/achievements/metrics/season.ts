/**
 * Seasonal metric (plan step 10): `season.played` { season } counts the days
 * in the recent log on which the child played during that season (any year:
 * seasons come back, so this is never a now-or-never gate). A day counts when
 * a session ended on it with at least one answer or completed. Kind
 * 'exploration': it rewards turning up in a festive week, never accuracy.
 * Zero when the child has seasonal touches switched off.
 */
import { isEnabled } from '../../flags';
import { activeSeasons, SEASON_FLAG } from '../../seasons';
import { dayKey } from '../../time';
import { registerMetric } from '../metrics';

registerMetric({
  id: 'season.played',
  kind: 'exploration',
  compute: (c, params) => {
    if (!isEnabled(SEASON_FLAG, c.profile.flags, undefined)) return 0;
    const season = String(params.season);
    const days = new Set<string>();
    for (const r of c.log) {
      if (r.type !== 'session' || r.phase !== 'end' || (!r.items && !r.completed)) continue;
      const day = dayKey(r.ts);
      if (!days.has(day) && (activeSeasons(day) as string[]).includes(season)) days.add(day);
    }
    return days.size;
  },
});
