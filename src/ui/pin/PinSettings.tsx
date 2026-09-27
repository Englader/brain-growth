/**
 * Grown-ups → Data → Parent PIN (DESIGN A-30): change the PIN (the current
 * one first), remove it (the current one first, then a confirmation; the next
 * visit asks to set one again), or set one when there is none. Says when the
 * PIN was last chosen through "Forgot PIN?", and that it is a lock against
 * children, not strong security.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { checkPin, pinWait, removeParentPin, setParentPin } from '../../app/pinActions';
import { useStore } from '../../app/store';
import { isPinShape, isWeakPin, PIN_MAX, PIN_MIN } from '../../core/pin/pin';
import { formatDate } from '../../i18n/dates';
import { getLocale } from '../../i18n/locales';
import { useT } from '../hooks';
import { PinEntry, waitText } from './PinEntry';
import './pin.css';

/** What the card is asking for: nothing, the current PIN (before a change or a removal), a new one twice, or "remove it?". */
type Mode = 'idle' | 'current' | 'new' | 'confirm' | 'removeAsk';

export function ParentPinCard(): JSX.Element {
  const t = useT();
  const rec = useStore((s) => s.meta?.parentPin ?? null);
  const [mode, setMode] = useState<Mode>('idle');
  const [then, setThen] = useState<'change' | 'remove'>('change');
  const [typed, setTyped] = useState('');
  const [chosen, setChosen] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pad, setPad] = useState(0);
  const [busy, setBusy] = useState(false);
  const [waitMs, setWaitMs] = useState(0);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  useEffect(() => {
    if (waitMs <= 0) return undefined;
    setMsg(waitText(t, waitMs));
    const id = window.setTimeout(() => {
      setWaitMs(0);
      setMsg(null);
    }, waitMs);
    return () => window.clearTimeout(id);
  }, [waitMs]);

  const go = (next: Mode, message: string | null = null): void => {
    setMode(next);
    setMsg(message);
    setTyped('');
    setPad((n) => n + 1);
  };
  const begin = (what: 'change' | 'remove' | 'set'): void => {
    setChosen('');
    if (what === 'set') return go('new');
    setThen(what);
    go('current');
    setWaitMs(pinWait());
  };

  const onCurrent = async (v: string): Promise<void> => {
    setBusy(true);
    const r = await checkPin(v);
    if (!live.current) return;
    setBusy(false);
    if (r.ok) return go(then === 'remove' ? 'removeAsk' : 'new');
    go('current', r.waitMs > 0 ? null : t('pin.wrong'));
    if (r.waitMs > 0) setWaitMs(r.waitMs);
  };
  const onNew = (v: string): void => {
    if (!isPinShape(v)) return go('new', t('pin.tooShort', { min: PIN_MIN, max: PIN_MAX }));
    if (isWeakPin(v)) return go('new', t('pin.weak'));
    setChosen(v);
    go('confirm');
  };
  const onConfirm = async (v: string): Promise<void> => {
    if (v !== chosen) return go('new', t('pin.mismatch'));
    const had = rec !== null;
    setBusy(true);
    try {
      await setParentPin(v, had ? 'change' : 'setup');
    } catch {
      if (live.current) setBusy(false);
      return go('idle', t('pin.noCrypto'));
    }
    if (!live.current) return;
    setBusy(false);
    go('idle', t(had ? 'pin.changed' : 'pin.setDone'));
  };

  const date = (ts: number): string => formatDate(ts, getLocale(t.locale), 'medium');
  const prompt = mode === 'current' ? t('pin.current') : mode === 'new' ? t('pin.newPin') : t('pin.confirm');
  return (
    <section class="card pin-card" data-mode={mode}>
      <h2>{t('pin.title')}</h2>
      <p>{rec ? t('pin.isSet', { date: date(rec.setAt) }) : t('pin.none')}</p>
      {rec?.resetAt && <p>{t('pin.wasReset', { date: date(rec.resetAt) })}</p>}
      {mode === 'idle' && (
        <div class="row wrap">
          {rec ? (
            <>
              <button type="button" class="btn" onClick={() => begin('change')}>
                {t('pin.change')}
              </button>
              <button type="button" class="btn" onClick={() => begin('remove')}>
                {t('pin.remove')}
              </button>
            </>
          ) : (
            <button type="button" class="btn primary" onClick={() => begin('set')}>
              {t('pin.set')}
            </button>
          )}
        </div>
      )}
      {(mode === 'current' || mode === 'new' || mode === 'confirm') && (
        <div class="pin-step stack">
          <h3>{prompt}</h3>
          {mode !== 'current' && <p class="muted">{t('pin.digits', { min: PIN_MIN, max: PIN_MAX })}</p>}
          {msg && (
            <p class="pin-msg" role="status">
              {msg}
            </p>
          )}
          <PinEntry
            value={typed}
            resetKey={`${mode}-${pad}`}
            onChange={setTyped}
            onSubmit={(v) => void (mode === 'current' ? onCurrent(v) : mode === 'new' ? onNew(v) : onConfirm(v))}
            submitLabel={mode === 'new' ? t('common.continue') : mode === 'confirm' ? t('common.save') : t('common.continue')}
            disabled={busy || waitMs > 0}
          />
          <button type="button" class="btn ghost" onClick={() => go('idle')}>
            {t('common.cancel')}
          </button>
        </div>
      )}
      {mode === 'removeAsk' && (
        <div class="pin-step stack">
          <p>{t('pin.removeAsk')}</p>
          <div class="row wrap">
            <button
              type="button"
              class="btn danger"
              onClick={() => {
                removeParentPin();
                go('idle', t('pin.removed'));
              }}
            >
              {t('pin.removeYes')}
            </button>
            <button type="button" class="btn" onClick={() => go('idle')}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
      {mode === 'idle' && msg && <p role="status">{msg}</p>}
      <p class="muted">{t('pin.honest')}</p>
    </section>
  );
}
