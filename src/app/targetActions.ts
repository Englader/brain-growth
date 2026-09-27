/**
 * Target ("Make it") actions beyond grading. The first solve of a deal is the
 * item's record (submitAnswer); every further distinct way the child finds is
 * an event, never an item record, so the retry-and-fix metrics never read it
 * as a corrected mistake (plan step 4).
 */
import { EVENTS } from '../core/log/types';
import { appendLog, event, saveProfile, unlockAchievements } from './persist';
import { getState, setState } from './store';

/**
 * Log one more distinct way for the active child's current Target item and
 * evaluate achievements (Many Ways). `n` counts the distinct ways found for
 * this deal, the first solve included. Returns newly unlocked achievement ids.
 */
export function recordTargetWay(itemKey: string, canon: string, repr: string, n: number): string[] {
  const st = getState();
  const s = st.session;
  const p = st.profile;
  if (!s || !p) return [];
  appendLog(p.id, [event(EVENTS.TARGET_WAY, { key: itemKey, canon, repr, n }, s.id)]);
  const a = unlockAchievements(p, 'item', s.id);
  if (!a.ids.length) return [];
  saveProfile(a.profile);
  const latest = getState().session;
  if (latest) setState({ session: { ...latest, achievements: [...latest.achievements, ...a.ids] } });
  return a.ids;
}
