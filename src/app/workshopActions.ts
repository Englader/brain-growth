/**
 * Workshop actions beyond grading. The first check of an item is its record
 * (submitAnswer); every further rectangle the child finds for a solved task
 * is an event, never an item record, so the retry-and-fix metrics never read
 * it as a corrected mistake.
 */
import { EVENTS } from '../core/log/types';
import { appendLog, event, saveProfile, unlockAchievements } from './persist';
import { getState, setState } from './store';

/**
 * Log one more rectangle shape that fits the active child's current Workshop
 * item and evaluate achievements (Shape Shifter). `n` counts the distinct
 * shapes found for this task, the first solve included. Returns newly
 * unlocked achievement ids.
 */
export function recordWorkshopShape(itemKey: string, repr: string, n: number): string[] {
  const st = getState();
  const s = st.session;
  const p = st.profile;
  if (!s || !p) return [];
  appendLog(p.id, [event(EVENTS.WORKSHOP_SHAPE, { key: itemKey, repr, n }, s.id)]);
  const a = unlockAchievements(p, 'item', s.id);
  if (!a.ids.length) return [];
  saveProfile(a.profile);
  const latest = getState().session;
  if (latest) setState({ session: { ...latest, achievements: [...latest.achievements, ...a.ids] } });
  return a.ids;
}
