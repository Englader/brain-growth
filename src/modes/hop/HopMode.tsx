import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { endSession } from '../../app/actions';
import { logFeedback } from '../../app/pilotActions';
import { navigate } from '../../app/router';
import { getState } from '../../app/store';
import type { PresentedItem } from '../../core/engine/session';
import { PlayView } from './PlayView';

interface Shown {
  pid: string;
  sid: string;
  key: string;
  attempt: number;
}

/** Number Trail: the untimed, default mode. */
export function HopMode(): JSX.Element {
  // Pilot instrumentation (I-1): time on the feedback after a wrong answer, from
  // PlayView's onFeedback(true) until the next item (onFeedback(false)), the end
  // of the session, or quitting. Logged as EVENTS.FEEDBACK { key, attempt, ms }.
  const shown = useRef<Shown | null>(null);
  const feedback = useRef<(Shown & { at: number }) | null>(null);
  const flushFeedback = (): void => {
    const f = feedback.current;
    feedback.current = null;
    if (f) logFeedback(f.pid, f.sid, f.key, f.attempt, performance.now() - f.at);
  };
  useEffect(() => flushFeedback, []);

  const onItemShown = (p: PresentedItem): void => {
    const s = getState().session;
    shown.current = s ? { pid: s.pid, sid: s.id, key: p.item.key, attempt: p.attempt } : null;
  };
  const onFeedback = (showing: boolean): void => {
    if (!showing) flushFeedback();
    else if (shown.current && !feedback.current) feedback.current = { ...shown.current, at: performance.now() };
  };
  const onFinished = (): void => {
    flushFeedback();
    endSession(true);
    navigate('/results', true);
  };
  const onExit = (): void => {
    flushFeedback();
    const answered = getState().session?.firstAttempts ?? 0;
    endSession(false);
    navigate(answered > 0 ? '/results' : '/', true);
  };
  return <PlayView onFinished={onFinished} onExit={onExit} onItemShown={onItemShown} onFeedback={onFeedback} />;
}
