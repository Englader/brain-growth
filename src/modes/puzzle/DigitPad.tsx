/**
 * A compact digit pad for puzzles that edit several fields (weights,
 * symbols, range ends): digits, delete and an optional sign key, no submit
 * key (the Check button is separate, since one empty field must not disable
 * checking the rest). A hardware keyboard works too; Enter checks.
 */
import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { Icon } from '../../ui/components/Icon';

export interface DigitPadProps {
  onKey: (key: string) => void;
  onEnter?: () => void;
  allowNegative?: boolean;
  disabled?: boolean;
  labels: { backspace: string; negative: string };
}

export function DigitPad(props: DigitPadProps): JSX.Element {
  const latest = useRef(props);
  latest.current = props;

  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const p = latest.current;
      if (p.disabled || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) p.onKey(e.key);
      else if (e.key === 'Backspace') p.onKey('back');
      else if (e.key === '-' && p.allowNegative) p.onKey('neg');
      else if (e.key === 'Enter' && p.onEnter) p.onEnter();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { onKey, allowNegative, disabled, labels } = props;
  // Once the puzzle is done the pad goes away: nothing is left to type.
  if (disabled) return <></>;
  return (
    <div class="numpad pz-digits" role="group">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
        <button type="button" class="key" disabled={disabled} onClick={() => onKey(k)}>
          {k}
        </button>
      ))}
      {allowNegative ? (
        <button type="button" class="key key-alt" disabled={disabled} aria-label={labels.negative} onClick={() => onKey('neg')}>
          ±
        </button>
      ) : (
        <span />
      )}
      <button type="button" class="key" disabled={disabled} onClick={() => onKey('0')}>
        0
      </button>
      <button type="button" class="key key-alt" disabled={disabled} aria-label={labels.backspace} onClick={() => onKey('back')}>
        <Icon name="backspace" size={26} />
      </button>
    </div>
  );
}
