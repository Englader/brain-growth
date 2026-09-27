/**
 * Coordinate plane (step 9c). Plot: tap the plane (the dot snaps to the
 * nearest lattice point), nudge with the arrows if needed, then confirm.
 * Read: the dot is given; type x, then y. The answer is the point "x,y",
 * graded by the coord.point checker from the item's own data.
 *
 * Every point shown in text goes through the locale's point notation
 * (LocaleConfig.point via formatPoint): "(3, −2)".
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { endSession, nextItem, submitAnswer } from '../../app/actions';
import { navigate } from '../../app/router';
import { flag } from '../../app/services';
import { getState, useStore } from '../../app/store';
import { play as sfx, unlockAudio } from '../../audio/sfx';
import { getBand } from '../../bands/registry';
import { formatPoint, parsePointRepr, PLANE_MAX, pointRepr, readCoordData, type CoordData, type Point } from '../../core/coord';
import type { AnswerResult, PresentedItem } from '../../core/engine/session';
import type { SolutionStep } from '../../core/items/types';
import { toNumber } from '../../core/rational';
import { getLocale } from '../../i18n/locales';
import { parseNumberInput } from '../../i18n/numbers';
import { promptText, solutionText } from '../../i18n/render';
import { LangToggle } from '../../ui/components/common';
import { Icon } from '../../ui/components/Icon';
import { Numpad } from '../../ui/components/Numpad';
import { useT } from '../../ui/hooks';
import { useFeedbackTime } from '../feedbackTime';
import { Plane } from './Plane';
import './coord.css';

type Phase = 'input' | 'correct' | 'explain';
type Field = 'x' | 'y';

export function CoordMode(): JSX.Element {
  const onFinished = (): void => {
    endSession(true);
    navigate('/results', true);
  };
  const onExit = (): void => {
    const answered = getState().session?.firstAttempts ?? 0;
    endSession(false);
    navigate(answered > 0 ? '/results' : '/', true);
  };
  return <CoordPlay onFinished={onFinished} onExit={onExit} />;
}

const clampP = (v: number): number => Math.max(-PLANE_MAX, Math.min(PLANE_MAX, v));

function CoordPlay({ onFinished, onExit }: { onFinished: () => void; onExit: () => void }): JSX.Element | null {
  const profile = useStore((s) => s.profile)!;
  const session = useStore((s) => s.session);
  const t = useT();
  const band = getBand(profile.band);
  const locale = profile.locale;
  const loc = getLocale(locale);

  const [cur, setCur] = useState<PresentedItem | null>(null);
  const [data, setData] = useState<CoordData | null>(null);
  const [pick, setPick] = useState<Point | null>(null);
  const [vals, setVals] = useState<Record<Field, string>>({ x: '', y: '' });
  const [field, setField] = useState<Field>('x');
  const [phase, setPhase] = useState<Phase>('input');
  const [res, setRes] = useState<AnswerResult | null>(null);
  const [given, setGiven] = useState<Point | null>(null);
  const [hintOn, setHintOn] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [praise, setPraise] = useState('');
  const shownAt = useRef(0);
  const timer = useRef(0);
  const fb = useFeedbackTime();
  const exit = (): void => {
    fb.flush();
    onExit();
  };

  const load = (): void => {
    window.clearTimeout(timer.current);
    fb.feedback(false);
    const p = nextItem();
    const d = p && p.item.prompt.kind === 'custom' ? readCoordData(p.item.prompt.data) : null;
    if (!p || !d) {
      fb.flush();
      onFinished();
      return;
    }
    fb.shown(p);
    setCur(p);
    setData(d);
    setPick(null);
    setVals({ x: '', y: '' });
    setField('x');
    setPhase('input');
    setRes(null);
    setGiven(null);
    setHintOn(false);
    setInvalid(false);
    shownAt.current = performance.now();
  };

  useEffect(() => {
    load();
    return () => window.clearTimeout(timer.current);
  }, []);

  if (!cur || !data || !session) return null;
  const item = cur.item;
  const target: Point = { x: data.x, y: data.y };
  const reading = data.read === 1;

  const submit = (p: Point): void => {
    if (phase !== 'input') return;
    unlockAudio();
    const r = submitAnswer(
      cur,
      { kind: 'built', value: null, repr: pointRepr(p) },
      // The one hint is a strategy prompt with no number in it: tier 1 of the ladder (0.75 credit).
      { latencyMs: performance.now() - shownAt.current, hint: hintOn, hintTier: hintOn ? 1 : 0, input: reading ? 'typed' : 'tap', hops: 0 },
    );
    if (r.grade.invalid) {
      setInvalid(true);
      sfx('soft');
      return;
    }
    setInvalid(false);
    setRes(r);
    setGiven(parsePointRepr(r.grade.given) ?? p);
    if (r.grade.correct) {
      setPhase('correct');
      sfx('yes');
      setPraise(t(`play.praise${1 + Math.floor(Math.random() * 4)}` as 'play.praise1'));
      timer.current = window.setTimeout(load, 1000);
      return;
    }
    sfx('soft');
    setPhase('explain');
    fb.feedback(true);
  };

  const readNumber = (raw: string): number | null => {
    const v = parseNumberInput(raw, loc.numbers);
    if (!v.ok) return null;
    const n = toNumber(v.candidates[0]!);
    return Number.isInteger(n) ? n : null;
  };

  const onNumpadSubmit = (raw: string): void => {
    const next = { ...vals, [field]: raw };
    setVals(next);
    if (field === 'x') {
      setField('y');
      return;
    }
    const x = readNumber(next.x);
    const y = readNumber(next.y);
    if (x === null || y === null) {
      setInvalid(true);
      sfx('soft');
      return;
    }
    submit({ x, y });
  };

  const nudge = (dx: number, dy: number): void => {
    const from = pick ?? { x: 0, y: 0 };
    setPick({ x: clampP(from.x + dx), y: clampP(from.y + dy) });
  };

  const planned = session.engine.planned;
  const firstPresented = session.engine.stats.firstPresented;
  const sayLines = item.solution.filter((s): s is Extract<SolutionStep, { k: 'say' }> => s.k === 'say');
  const fmt = (p: Point): string => formatPoint(p, loc);
  const hintsOn = flag('hints');

  return (
    <div class={`play coord-play phase-${phase}${reading ? ' coord-read' : ' coord-plot'}`}>
      <header class="play-head">
        <button type="button" class="icon-btn" aria-label={t('play.exit')} onClick={exit}>
          <Icon name="close" />
        </button>
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={planned} aria-valuenow={firstPresented} aria-label={t('play.progress', { n: firstPresented, total: planned })}>
          <div class="progress-fill" style={{ width: `${Math.min(100, (firstPresented / planned) * 100)}%` }} />
        </div>
        <LangToggle />
      </header>

      <section class="prompt coord-prompt" aria-live="polite">
        {cur.attempt > 1 && <span class="badge">{t('play.again')}</span>}
        <p class="prompt-text">{promptText(item, locale, profile.band)}</p>
        {hintOn && <p class="hint-text">{t(reading ? 'coord.hint.read' : 'coord.hint.plot')}</p>}
      </section>

      <div class="plane-wrap">
        <Plane
          locale={locale}
          label={t('coord.plane')}
          dot={reading ? target : phase === 'explain' ? given : pick}
          ghost={reading && phase === 'explain' ? given : null}
          glow={phase === 'explain' ? target : null}
          {...(!reading && phase === 'input' ? { onPick: (p: Point) => setPick(p) } : {})}
        />
      </div>

      <section class="feedback" aria-live="assertive">
        {invalid && <p class="invalid">{t('play.invalid')}</p>}
        {phase === 'correct' && <p class="praise">{praise}</p>}
        {phase === 'explain' && res && given && (
          <div class="explain">
            <h2>{t('play.lookTogether')}</h2>
            <p>{t(reading ? 'coord.youRead' : 'coord.youPut', { given: fmt(given), answer: fmt(target) })}</p>
            {(band.feedback === 'worked' ? sayLines : sayLines.slice(0, 4)).map((s) => (
              <p class="step">{solutionText(s, locale, profile.band)}</p>
            ))}
            {res.grade.misconception && <p class="tip">{t.dyn(`mis.${res.grade.misconception}.tip`)}</p>}
            {res.willReturn && <p class="note">{t('play.comesBack')}</p>}
          </div>
        )}
      </section>

      <section class="controls">
        {phase === 'explain' ? (
          <button type="button" class="btn primary big" onClick={load}>
            {t('play.gotIt')}
          </button>
        ) : reading ? (
          <>
            <div class="coord-fields">
              {(['x', 'y'] as const).map((f) => (
                <button
                  type="button"
                  class={`typed coord-field${field === f ? ' on' : ''}`}
                  data-field={f}
                  aria-pressed={field === f}
                  aria-label={t(f === 'x' ? 'coord.xField' : 'coord.yField')}
                  onClick={() => {
                    setField(f);
                    setVals((v) => ({ ...v, [f]: '' }));
                  }}
                >
                  <span class="coord-var">{t(f === 'x' ? 'coord.x' : 'coord.y')}</span>
                  <span class="coord-eq">=</span>
                  <span>{vals[f] || <span class="placeholder">?</span>}</span>
                </button>
              ))}
            </div>
            <Numpad
              value={vals[field]}
              resetKey={`${item.key}#${cur.attempt}#${field}`}
              onChange={(v) => {
                setVals((o) => ({ ...o, [field]: v }));
                setInvalid(false);
              }}
              onSubmit={onNumpadSubmit}
              decimal={loc.numbers.decimal}
              allowDecimal={false}
              allowNegative
              submitLabel={field === 'x' ? t('coord.next') : t('coord.confirm')}
              labels={{ backspace: t('play.backspace'), negative: t('play.negative') }}
              disabled={phase !== 'input'}
            />
          </>
        ) : (
          <>
            {!pick && <p class="note center">{t('coord.tapPlane')}</p>}
            <div class="coord-nudge">
              <button type="button" class="chip num" aria-label={t('coord.left')} data-nudge="left" onClick={() => nudge(-1, 0)}>
                <Icon name="arrowL" size={22} />
              </button>
              <button type="button" class="chip num" aria-label={t('coord.down')} data-nudge="down" onClick={() => nudge(0, -1)}>
                <Icon name="arrowD" size={22} />
              </button>
              <button type="button" class="chip num" aria-label={t('coord.up')} data-nudge="up" onClick={() => nudge(0, 1)}>
                <Icon name="arrowU" size={22} />
              </button>
              <button type="button" class="chip num" aria-label={t('coord.right')} data-nudge="right" onClick={() => nudge(1, 0)}>
                <Icon name="arrowR" size={22} />
              </button>
            </div>
            <button type="button" class="btn primary big" data-confirm disabled={!pick || phase !== 'input'} onClick={() => pick && submit(pick)}>
              {t('coord.confirm')}
            </button>
          </>
        )}
        {phase === 'input' && hintsOn && !hintOn && (
          <button type="button" class="btn ghost small hint-btn" onClick={() => setHintOn(true)}>
            <Icon name="hint" size={18} /> {t('play.hint')}
          </button>
        )}
      </section>
    </div>
  );
}
