/**
 * Typing the parent PIN (DESIGN A-30): the digits show only as dots, and the
 * app's own numpad takes them, so phones and tablets need no keyboard (a
 * hardware keyboard works too). Used by the gate and by Grown-ups → Data.
 */
import type { JSX } from 'preact';
import { PIN_MAX, PIN_MIN } from '../../core/pin/pin';
import type { Translator } from '../../i18n/i18n';
import { Numpad } from '../components/Numpad';
import { useT } from '../hooks';
import './pin.css';

export function PinDots({ n }: { n: number }): JSX.Element {
  const t = useT();
  return (
    <div class="pin-dots" role="img" aria-label={t('pin.entered', { n })}>
      {Array.from({ length: Math.max(PIN_MIN, n) }, (_, i) => (
        <span class={`pin-dot${i < n ? ' on' : ''}`} />
      ))}
    </div>
  );
}

export interface PinEntryProps {
  value: string;
  /** Changing it clears the pad (after a wrong PIN, or between steps). */
  resetKey: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  submitLabel: string;
  disabled?: boolean;
}

export function PinEntry({ value, resetKey, onChange, onSubmit, submitLabel, disabled }: PinEntryProps): JSX.Element {
  const t = useT();
  return (
    <div class="pin-entry">
      <PinDots n={value.length} />
      <Numpad
        value={value}
        resetKey={resetKey}
        onChange={onChange}
        onSubmit={onSubmit}
        decimal=","
        allowDecimal={false}
        allowNegative={false}
        submitLabel={submitLabel}
        labels={{ backspace: t('play.backspace'), negative: t('play.negative') }}
        disabled={disabled}
        maxLength={PIN_MAX}
        code
      />
    </div>
  );
}

/** "about 30 seconds" / "about 2 minutes": how long until the next PIN may be tried (no ticking clock). */
export function waitText(t: Translator, ms: number): string {
  const time = ms < 60_000 ? t('pin.seconds', { n: Math.max(1, Math.ceil(ms / 1000)) }) : t('pin.minutes', { n: Math.ceil(ms / 60_000) });
  return t('pin.wait', { time });
}
