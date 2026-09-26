/** Small shared UI pieces: language toggle, top bar, hold-to-open button, toast. */
import type { ComponentChildren, JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { setUiLocale, switchLocale } from '../../app/actions';
import { useStore } from '../../app/store';
import { allLocales } from '../../i18n/locales';
import { useT } from '../hooks';
import { Icon } from './Icon';

/** Always-visible language switch. Text labels, never flags (flags are countries, not languages). */
export function LangToggle(): JSX.Element {
  const profile = useStore((s) => s.profile);
  const t = useT();
  const current = t.locale;
  return (
    <div class="lang" role="group">
      {allLocales().map((l) => (
        <button
          type="button"
          class={l.id === current ? 'on' : ''}
          aria-pressed={l.id === current}
          aria-label={t('lang.switchTo', { lang: l.nativeName })}
          lang={l.bcp47}
          onClick={() => (profile ? switchLocale(l.id) : setUiLocale(l.id))}
        >
          {l.short}
        </button>
      ))}
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

/** Press-and-hold button (adult gate). Not security — a speed bump for small hands. */
export function HoldButton({ onDone, children, label, ms = 2000 }: { onDone: () => void; children: ComponentChildren; label: string; ms?: number }): JSX.Element {
  const [progress, setProgress] = useState(0);
  const raf = useRef(0);
  const start = useRef(0);
  const tick = (): void => {
    const p = Math.min(1, (performance.now() - start.current) / ms);
    setProgress(p);
    if (p >= 1) {
      setProgress(0);
      onDone();
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };
  const down = (): void => {
    start.current = performance.now();
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  };
  const up = (): void => {
    cancelAnimationFrame(raf.current);
    setProgress(0);
  };
  return (
    <button
      type="button"
      class="hold-btn"
      aria-label={label}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      style={{ '--hold': String(progress) } as JSX.CSSProperties}
    >
      {children}
    </button>
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
