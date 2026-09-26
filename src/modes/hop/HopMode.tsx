import type { JSX } from 'preact';
import { endSession } from '../../app/actions';
import { navigate } from '../../app/router';
import { getState } from '../../app/store';
import { PlayView } from './PlayView';

/** Number Trail: the untimed, default mode. */
export function HopMode(): JSX.Element {
  const onFinished = (): void => {
    endSession(true);
    navigate('/results', true);
  };
  const onExit = (): void => {
    const answered = getState().session?.firstAttempts ?? 0;
    endSession(false);
    navigate(answered > 0 ? '/results' : '/', true);
  };
  return <PlayView onFinished={onFinished} onExit={onExit} />;
}
