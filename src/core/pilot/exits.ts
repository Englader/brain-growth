/**
 * Pilot instrumentation (DESIGN §5.2, I-1): how a session ended. Pure; the
 * session actions fill SessionRecord.lastCorrect / exitIndex from these.
 */
import type { LogRecord } from '../log/types';

/** Whether the last answer logged in session `sid` was correct (any attempt); null if nothing was answered. */
export function lastAnswerCorrect(log: readonly LogRecord[], sid: string): boolean | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const r = log[i]!;
    if (r.sid !== sid) continue;
    if (r.type === 'item') return r.correct;
    if (r.type === 'session' && r.phase === 'start') return null;
  }
  return null;
}

/** For a session left early, how many items had been shown when the child quit (1 = on the first item); null when it ran to the end. */
export function exitIndex(completed: boolean, itemsShown: number): number | null {
  return completed ? null : itemsShown;
}
