/**
 * The door to the Grown-ups area (DESIGN A-30). Every way in (the picker's
 * button, Settings, a typed #/adult) renders this until the parent PIN is
 * entered (App.tsx). Three flows:
 *   - unlock: enter the PIN (a wait after the fifth wrong one in a row);
 *   - setup, when no PIN exists: a question for grown-ups (37 × 24), so a
 *     young child cannot claim the PIN first, then the PIN twice;
 *   - reset ("Forgot PIN?"): a harder question, then a new PIN twice.
 * A lock against children, not strong security: the screen says so.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AdultScreen } from '../../adult/screen';
import { ADULT_IDLE_MS, unlockAdult } from '../../app/adultLock';
import { hasPin, pinWait, setParentPin, unlockWithPin } from '../../app/pinActions';
import { navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { canHashPins, gateQuestion, isPinShape, isWeakPin, PIN_MAX, PIN_MIN, type GateKind } from '../../core/pin/pin';
import { createRng, freshSeed } from '../../core/rng';
import { getLocale } from '../../i18n/locales';
import { Numpad } from '../components/Numpad';
import { Icon } from '../components/Icon';
import { TopBar } from '../components/common';
import { useT } from '../hooks';
import { PinEntry, waitText } from './PinEntry';
import './pin.css';

type Flow = 'unlock' | 'setup' | 'reset';
type Step = 'unlock' | 'gate' | 'create' | 'confirm';

const newQuestion = (kind: GateKind) => gateQuestion(createRng(freshSeed()), kind);

export function PinGate(): JSX.Element {
  const t = useT();
  const readOnly = useStore((s) => s.readOnly);
  const idle = useStore((s) => s.adultLock === 'idle');
  const [flow, setFlow] = useState<Flow>(() => (hasPin() ? 'unlock' : 'setup'));
  const [step, setStep] = useState<Step>(() => (hasPin() ? 'unlock' : 'gate'));
  const [typed, setTyped] = useState('');
  const [chosen, setChosen] = useState('');
  const [msg, setMsg] = useState<string | null>(() => (idle ? t('pin.idle', { n: ADULT_IDLE_MS / 60_000 }) : null));
  const [pad, setPad] = useState(0);
  const [busy, setBusy] = useState(false);
  const [waitMs, setWaitMs] = useState(() => (hasPin() ? pinWait() : 0));
  const [question, setQuestion] = useState(() => newQuestion('setup'));
  const live = useRef(true);

  // The dashboard's chunk loads while the PIN is typed.
  useEffect(() => {
    void AdultScreen.preload().catch(() => undefined);
    return () => {
      live.current = false;
    };
  }, []);

  // After a wait the pad opens again by itself (the message says roughly when; nothing ticks).
  useEffect(() => {
    if (waitMs <= 0) return undefined;
    setMsg(waitText(t, waitMs));
    const id = window.setTimeout(() => {
      setWaitMs(0);
      setMsg(null);
    }, waitMs);
    return () => window.clearTimeout(id);
  }, [waitMs]);

  const clear = (): void => {
    setTyped('');
    setPad((n) => n + 1);
  };
  const go = (next: Step, message: string | null = null): void => {
    setStep(next);
    setMsg(message);
    clear();
  };
  const startFlow = (f: Flow): void => {
    setFlow(f);
    setChosen('');
    if (f !== 'unlock') setQuestion(newQuestion(f === 'reset' ? 'reset' : 'setup'));
    go(f === 'unlock' ? 'unlock' : 'gate');
    if (f === 'unlock') setWaitMs(pinWait());
  };

  const onGate = (v: string): void => {
    if (Number(v) === question.answer) return go('create');
    // A new question for every attempt.
    setQuestion(newQuestion(flow === 'reset' ? 'reset' : 'setup'));
    go('gate', t('pin.gateWrong'));
  };
  const onCreate = (v: string): void => {
    if (!isPinShape(v)) return go('create', t('pin.tooShort', { min: PIN_MIN, max: PIN_MAX }));
    if (isWeakPin(v)) return go('create', t('pin.weak'));
    setChosen(v);
    go('confirm');
  };
  const onConfirm = async (v: string): Promise<void> => {
    if (v !== chosen) {
      setChosen('');
      return go('create', t('pin.mismatch'));
    }
    setBusy(true);
    try {
      await setParentPin(v, flow === 'reset' ? 'reset' : 'setup');
    } catch {
      setBusy(false);
      return go('create', t('pin.noCrypto'));
    }
    unlockAdult();
  };
  const onUnlock = async (v: string): Promise<void> => {
    if (!isPinShape(v)) return go('unlock', t('pin.wrong'));
    setBusy(true);
    const r = await unlockWithPin(v);
    if (!live.current || r.ok) return;
    setBusy(false);
    clear();
    if (r.waitMs > 0) setWaitMs(r.waitMs);
    else setMsg(t('pin.wrong'));
  };

  const heading =
    step === 'unlock' ? t('pin.enter') : step === 'gate' ? t('pin.gateTitle') : step === 'confirm' ? t('pin.confirm') : flow === 'reset' ? t('pin.newPin') : t('pin.create');
  // Setting a PIN needs WebCrypto (a secure page) and a tab that may write.
  const blocked = !canHashPins() ? t('pin.noCrypto') : flow !== 'unlock' && readOnly ? t('pin.readOnly') : null;

  return (
    <div class={`screen pin-gate ${flow}`} data-step={step}>
      <TopBar title={flow === 'setup' ? t('pin.setupTitle') : t('pin.title')} onBack={() => (flow === 'reset' && hasPin() ? startFlow('unlock') : navigate('/'))} />
      <div class="pin-body stack">
        {flow === 'setup' && step === 'gate' && <p>{t('pin.setupIntro')}</p>}
        {flow === 'reset' && step === 'gate' && <p>{t('pin.forgotIntro')}</p>}
        <h2 class="pin-head">
          <Icon name="lock" size={22} /> {heading}
        </h2>
        {blocked ? (
          <p class="warn">{blocked}</p>
        ) : step === 'gate' ? (
          <>
            <p class="pin-question">{t('pin.gateQuestion', { a: question.a, op: getLocale(t.locale).ops['*'], b: question.b })}</p>
            <div class="typed pin-answer" aria-live="polite">
              {typed || <span class="placeholder">{t('play.typeNumber')}</span>}
            </div>
            {msg && (
              <p class="pin-msg" role="status">
                {msg}
              </p>
            )}
            <Numpad
              value={typed}
              resetKey={`gate-${pad}`}
              onChange={setTyped}
              onSubmit={onGate}
              decimal=","
              allowDecimal={false}
              allowNegative={false}
              submitLabel={t('pin.check')}
              labels={{ backspace: t('play.backspace'), negative: t('play.negative') }}
              maxLength={5}
            />
            {flow === 'setup' && <p class="muted">{t('pin.gateHelp')}</p>}
          </>
        ) : (
          <>
            {step !== 'unlock' && <p class="muted center">{t('pin.digits', { min: PIN_MIN, max: PIN_MAX })}</p>}
            {msg && (
              <p class="pin-msg" role="status">
                {msg}
              </p>
            )}
            <PinEntry
              value={typed}
              resetKey={`${step}-${pad}`}
              onChange={setTyped}
              onSubmit={(v) => void (step === 'unlock' ? onUnlock(v) : step === 'create' ? onCreate(v) : onConfirm(v))}
              submitLabel={step === 'unlock' ? t('pin.open') : step === 'create' ? t('common.continue') : t('common.save')}
              disabled={busy || waitMs > 0}
            />
            {step === 'unlock' && (
              <button type="button" class="btn ghost pin-link" onClick={() => startFlow('reset')}>
                {t('pin.forgot')}
              </button>
            )}
          </>
        )}
        {(flow === 'reset' || (flow === 'setup' && step !== 'gate')) && <p class="muted pin-honest">{t('pin.honest')}</p>}
      </div>
    </div>
  );
}
