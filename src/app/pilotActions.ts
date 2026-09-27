/**
 * Pilot instrumentation actions (DESIGN §5.2, I-1). Logging only: nothing
 * here changes what a child sees or how the engine rates them.
 */
import { EVENTS } from '../core/log/types';
import { appendLog, event } from './persist';

/** Time a child spent on the feedback after a wrong answer (until the next item, or quitting). */
export function logFeedback(pid: string, sid: string, key: string, attempt: number, ms: number): void {
  appendLog(pid, [event(EVENTS.FEEDBACK, { key, attempt, ms: Math.max(0, Math.round(ms)) }, sid)]);
}
