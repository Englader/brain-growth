import type { JSX } from 'preact';
import { endSession } from '../../app/actions';
import { navigate } from '../../app/router';
import { getState } from '../../app/store';
import { useFeedbackTime } from '../feedbackTime';
import { PlayView } from './PlayView';

/** Number Trail: the untimed, default mode. */
export function HopMode(): JSX.Element {
  // Pilot instrumentation (I-1): time on the feedback after a wrong answer, from
  // PlayView's onFeedback(true) until the next item (onFeedback(false)), the end
  // of the session, or quitting (../feedbackTime).
  const fb = useFeedbackTime();
  const onFinished = (): void => {
    fb.flush();
    endSession(true);
    navigate('/results', true);
  };
  const onExit = (): void => {
    fb.flush();
    const answered = getState().session?.firstAttempts ?? 0;
    endSession(false);
    navigate(answered > 0 ? '/results' : '/', true);
  };
  return <PlayView onFinished={onFinished} onExit={onExit} onItemShown={fb.shown} onFeedback={fb.feedback} />;
}
