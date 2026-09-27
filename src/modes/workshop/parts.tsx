/** Small pieces both Workshop boards use: ± steppers, the hint line and the tool row. */
import type { ComponentChildren, JSX } from 'preact';
import { play as sfx } from '../../audio/sfx';
import type { MessageKey } from '../../i18n/i18n';
import { numberText } from '../../i18n/render';
import { Icon } from '../../ui/components/Icon';
import { useT } from '../../ui/hooks';
import type { Build } from './useBuild';

export function Stepper(props: {
  cls: string;
  label: string;
  value: number;
  min: number;
  max: number;
  down: string;
  up: string;
  disabled?: boolean;
  locale: string;
  onChange: (v: number) => void;
}): JSX.Element {
  const { value, min, max } = props;
  const set = (v: number): void => {
    if (v < min || v > max || v === value) return;
    sfx('tap');
    props.onChange(v);
  };
  return (
    <div class={`ws-stepper ${props.cls}`} role="group" aria-label={props.label}>
      <span class="ws-stepper-label">{props.label}</span>
      <div class="ws-stepper-row">
        <button type="button" class="ws-step down" aria-label={props.down} disabled={props.disabled || value <= min} onClick={() => set(value - 1)}>
          <Icon name="minus" size={26} />
        </button>
        <output class="ws-step-value" aria-live="polite">
          {numberText(value, props.locale)}
        </output>
        <button type="button" class="ws-step up" aria-label={props.up} disabled={props.disabled || value >= max} onClick={() => set(value + 1)}>
          <Icon name="plus" size={26} />
        </button>
      </div>
    </div>
  );
}

/** The hint line under the prompt: the highest tier taken so far. */
export function HintLine({ b }: { b: Build }): JSX.Element | null {
  const t = useT();
  const h = b.tier > 0 ? b.hints[b.tier - 1] : undefined;
  if (!h || b.phase !== 'build') return null;
  return <p class="hint-text ws-hint">{t.dyn(h.key, h.params)}</p>;
}

/** Hint and "show me" while building; `children` is the main action (Check, or Next). */
export function Tools({ b, children }: { b: Build; children: ComponentChildren }): JSX.Element {
  const t = useT();
  return (
    <section class="controls ws-controls">
      {b.phase === 'build' && (
        <div class="ws-tools">
          {b.hintsOn && b.tier < b.hints.length && (
            <button type="button" class="btn small ghost ws-hint-btn" onClick={b.takeHint}>
              <Icon name="hint" size={18} /> {t('play.hint')}
            </button>
          )}
          <button type="button" class="btn small ghost ws-show" onClick={b.reveal}>
            <Icon name="eye" size={18} /> {t('workshop.showMe')}
          </button>
        </div>
      )}
      {children}
    </section>
  );
}

export function Praise({ b }: { b: Build }): JSX.Element {
  const t = useT();
  return <p class="praise">{t(`play.praise${b.praise}` as MessageKey)}</p>;
}
