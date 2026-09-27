/**
 * Custom numpad: no OS keyboard, no autocorrect, big thumb-sized keys. The
 * decimal key shows the locale's separator (',' in Macedonian); the parser
 * accepts either anyway. A hardware keyboard also works (digits, both
 * separators, minus, Backspace, Enter).
 */
import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon';

export interface NumpadProps {
  /** Display value (mirrors onChange); the numpad itself owns the live value. */
  value: string;
  /** Changing this clears the numpad (a new item). */
  resetKey: string;
  onChange: (v: string) => void;
  /** Receives the value at the moment of submission (never a stale render value). */
  onSubmit: (value: string) => void;
  decimal: string;
  allowDecimal: boolean;
  allowNegative: boolean;
  submitLabel: string;
  labels: { backspace: string; negative: string };
  disabled?: boolean;
  maxLength?: number;
  /** A code (the parent PIN), not a number: a leading 0 is kept rather than replaced by the next digit. */
  code?: boolean;
}

export function Numpad(props: NumpadProps): JSX.Element {
  const { value, decimal, allowDecimal, allowNegative, submitLabel, labels, disabled, resetKey } = props;
  // Fast typing (or a hardware keyboard) can deliver several presses before the
  // parent re-renders. The numpad therefore owns the live value in a ref that
  // is updated synchronously per press, and is only cleared when the item
  // changes — never synced back from a (possibly stale) render.
  const live = useRef('');
  const lastKey = useRef(resetKey);
  if (lastKey.current !== resetKey) {
    lastKey.current = resetKey;
    live.current = '';
  }
  const latest = useRef(props);
  latest.current = props;

  const press = (k: string): void => {
    const p = latest.current;
    if (p.disabled) return;
    const v = live.current;
    let next = v;
    if (k === 'back') next = v.slice(0, -1);
    else if (k === 'neg') next = v.startsWith('−') ? v.slice(1) : `−${v}`;
    else if (k === 'dec') {
      if (!/[.,]/.test(v)) next = `${v || '0'}${p.decimal}`;
    } else if (v.replace(/[−.,]/g, '').length < (p.maxLength ?? 9)) next = v === '0' && !p.code ? k : v + k;
    if (next === v) return;
    live.current = next;
    p.onChange(next);
  };
  const submit = (): void => {
    const p = latest.current;
    if (p.disabled || live.current === '' || live.current === '−') return;
    p.onSubmit(live.current);
  };

  // Layout effect: the listener exists as soon as the pad is on screen.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const p = latest.current;
      if (p.disabled || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if ((e.key === '.' || e.key === ',') && p.allowDecimal) press('dec');
      else if (e.key === '-' && p.allowNegative) press('neg');
      else if (e.key === 'Enter') submit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const special = allowNegative ? 'neg' : allowDecimal ? 'dec' : null;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div class="numpad" role="group">
      {keys.map((k) => (
        <button type="button" class="key" disabled={disabled} onClick={() => press(k)}>
          {k}
        </button>
      ))}
      {special ? (
        <button type="button" class="key key-alt" disabled={disabled} aria-label={special === 'neg' ? labels.negative : decimal} onClick={() => press(special)}>
          {special === 'neg' ? '±' : decimal}
        </button>
      ) : (
        <span />
      )}
      <button type="button" class="key" disabled={disabled} onClick={() => press('0')}>
        0
      </button>
      <button type="button" class="key key-alt" disabled={disabled} aria-label={labels.backspace} onClick={() => press('back')}>
        <Icon name="backspace" size={26} />
      </button>
      <button type="button" class="key key-submit" disabled={disabled || value === '' || value === '−'} onClick={submit}>
        {submitLabel}
      </button>
    </div>
  );
}
