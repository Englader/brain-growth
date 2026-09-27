/**
 * Pilot instrumentation (I-1, DESIGN §5.2): time a child spends on the
 * feedback after a wrong answer, from when it appears until the next item,
 * the end of the session, or quitting. Logged as EVENTS.FEEDBACK
 * { key, attempt, ms } for the session's child. Untimed engine modes use it:
 * call `shown` when an item appears, `feedback(true/false)` as the feedback
 * after a mistake opens and closes, and `flush()` before ending the session.
 * Sprint does not: its feedback is brief by design and would skew the readout.
 */
import { useEffect, useRef } from 'preact/hooks';
import { logFeedback } from '../app/pilotActions';
import { getState } from '../app/store';
import type { PresentedItem } from '../core/engine/session';

interface Shown {
  pid: string;
  sid: string;
  key: string;
  attempt: number;
}

export interface FeedbackTimer {
  shown(p: PresentedItem): void;
  feedback(showing: boolean): void;
  flush(): void;
}

export function useFeedbackTime(): FeedbackTimer {
  const current = useRef<Shown | null>(null);
  const open = useRef<(Shown & { at: number }) | null>(null);
  const timer = useRef<FeedbackTimer | null>(null);
  timer.current ??= {
    shown: (p) => {
      const s = getState().session;
      current.current = s ? { pid: s.pid, sid: s.id, key: p.item.key, attempt: p.attempt } : null;
    },
    feedback: (showing) => {
      if (!showing) timer.current!.flush();
      else if (current.current && !open.current) open.current = { ...current.current, at: performance.now() };
    },
    flush: () => {
      const f = open.current;
      open.current = null;
      if (f) logFeedback(f.pid, f.sid, f.key, f.attempt, performance.now() - f.at);
    },
  };
  // Leaving the screen (quitting mid-feedback) closes it too.
  useEffect(() => () => timer.current!.flush(), []);
  return timer.current;
}
