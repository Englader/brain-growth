/**
 * Seasonal touches (plan step 10; DESIGN §1.9): the glue between the pure
 * calendar (src/core/seasons.ts) and a child. Everything seasonal asks here
 * whether it applies: the `data-season` decoration, seasonal drops, the
 * seasonal weekly theme and the Band A greeting. A per-child flag (default
 * on) switches them all off for families who prefer a plain app.
 */
import { isEnabled } from '../core/flags';
import type { Profile } from '../core/profile';
import { SEASON_FLAG, seasonFor, type SeasonId } from '../core/seasons';
import { getState } from './store';

/** Seasonal touches are on for this child (profile flag, device flag, URL override; default on). */
export function seasonOn(p: Profile): boolean {
  return isEnabled(SEASON_FLAG, p.flags, getState().meta?.deviceFlags ?? {});
}

/**
 * The season to decorate and greet with at `t`: null out of season or when
 * the child has seasonal touches off. With no child (the create and picker
 * screens) the calendar alone decides.
 */
export function seasonNow(p: Profile | null, t: number): SeasonId | null {
  if (p && !seasonOn(p)) return null;
  return seasonFor(t);
}

/**
 * The date seasonal drops are judged on for `p` (pickCosmetic / rollDrop), or
 * undefined when seasonal touches are off, so nothing seasonal drops.
 */
export function seasonalDropDate(p: Profile, t: number): number | undefined {
  return seasonOn(p) ? t : undefined;
}
