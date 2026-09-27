/** Small shared UI pieces: language toggle, top bar, toast, card. */
import type { ComponentChildren, JSX } from 'preact';
import { setUiLocale, switchLocale } from '../../app/actions';
import { useStore } from '../../app/store';
import { allLocales } from '../../i18n/locales';
import { useT } from '../hooks';
import { Icon } from './Icon';

/** Always-visible language switch. Text labels, never flags (flags are countries, not languages). */
export function LangToggle(): JSX.Element {
  const profile = useStore((s) => s.profile);
  const pending = useStore((s) => s.localePending);
  const t = useT();
  const current = t.locale;
  return (
    <div class="lang" role="group">
      {allLocales().map((l) => {
        // A language whose bundle is still on its way (a tap before the idle prefetch finished): busy, not yet pressed.
        const busy = pending === l.id;
        return (
          <button
            type="button"
            class={l.id === current ? 'on' : busy ? 'busy' : ''}
            aria-pressed={l.id === current}
            aria-busy={busy || undefined}
            aria-label={t(busy ? 'lang.loading' : 'lang.switchTo', { lang: l.nativeName })}
            lang={l.bcp47}
            onClick={() => (profile ? switchLocale(l.id) : setUiLocale(l.id))}
          >
            {l.short}
          </button>
        );
      })}
    </div>
  );
}

export function TopBar({ title, onBack, right }: { title?: string; onBack?: () => void; right?: ComponentChildren }): JSX.Element {
  const t = useT();
  return (
    <header class="topbar">
      {onBack ? (
        <button type="button" class="icon-btn" aria-label={t('common.back')} onClick={onBack}>
          <Icon name="back" />
        </button>
      ) : (
        <span class="icon-btn-spacer" />
      )}
      {title ? <h1 class="topbar-title">{title}</h1> : <span class="grow" />}
      <div class="topbar-right">{right ?? <LangToggle />}</div>
    </header>
  );
}

export function Toast(): JSX.Element | null {
  const msg = useStore((s) => s.toast);
  return msg ? (
    <div class="toast" role="status">
      {msg}
    </div>
  ) : null;
}

export function Card({ children, class: cls = '' }: { children: ComponentChildren; class?: string }): JSX.Element {
  return <section class={`card ${cls}`}>{children}</section>;
}
