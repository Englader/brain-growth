/**
 * The Hop play view, shared by the Number Trail (untimed) and Sprint (timed).
 *
 * "Is the math the verb?" — yes: the answer IS a place on the number line.
 * A wrong answer produces a meaningful state (you landed 10 too far: a
 * place-value slip is visible as distance), and the worked solution replays
 * the strategy as hops on the same line.
 *
 * Band A: hop buttons (+1, +10, +size) and tappable pads — counting on is
 *         literally pressing "hop" and knowing when to stop. No text needed.
 * Band B/C: numpad; the marker moves along the ruler as digits are typed,
 *         so place value has a visible magnitude. Estimates are tapped.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { nextItem, submitAnswer } from '../../app/actions';
import { flag, speaker } from '../../app/services';
import { useStore } from '../../app/store';
import { play as sfx, unlockAudio } from '../../audio/sfx';
import { getBand } from '../../bands/registry';
import type { AnswerResult, PresentedItem } from '../../core/engine/session';
import type { Response } from '../../core/items/grade';
import type { Item, SolutionStep } from '../../core/items/types';
import type { InputMethod } from '../../core/log/types';
import { parseKey, toNumber } from '../../core/rational';
import { getLocale } from '../../i18n/locales';
import { answerText, customVoice, numberText, promptText, solutionText, spokenPrompt } from '../../i18n/render';
import { animateHops, unitHops, type HopFrame } from '../../ui/anim';
import { LangToggle } from '../../ui/components/common';
import { Icon } from '../../ui/components/Icon';
import { PadsLine, RulerLine } from '../../ui/components/NumberLine';
import { Numpad } from '../../ui/components/Numpad';
import { Blocks, Dots, ExprView, Groups } from '../../ui/components/Prompts';
import { lookFor, useT } from '../../ui/hooks';
import { HintButton, HintText, useHintLadder } from './HintLadder';

type Phase = 'input' | 'moving' | 'correct' | 'wrong' | 'errorless' | 'explain';

export interface PlayViewProps {
  onFinished: () => void;
  onExit: () => void;
  onItemShown?: (p: PresentedItem) => void;
  onAnswered?: (res: AnswerResult, latencyMs: number) => void;
  /** Timed runs: brief feedback, no errorless step, keep momentum. */
  fastFeedback?: boolean;
  /** Pause timing while feedback is on screen (learning is never on the clock). */
  onFeedback?: (showing: boolean) => void;
  headerExtra?: ComponentChildren;
}

const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function PlayView(props: PlayViewProps): JSX.Element | null {
  const profile = useStore((s) => s.profile)!;
  const session = useStore((s) => s.session);
  const t = useT();
  const band = getBand(profile.band);
  const locale = profile.locale;
  const look = lookFor(profile);

  const [cur, setCur] = useState<PresentedItem | null>(null);
  const [phase, setPhase] = useState<Phase>('input');
  const [frame, setFrame] = useState<HopFrame>({ pos: 0, lift: 0 });
  const [hops, setHops] = useState(0);
  const [typed, setTyped] = useState('');
  const [pick, setPick] = useState<number | null>(null);
  const [res, setRes] = useState<AnswerResult | null>(null);
  const [trail, setTrail] = useState<Array<{ from: number; to: number }>>([]);
  const [ghost, setGhost] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [praise, setPraise] = useState('');
  const shownAt = useRef(0);
  const logical = useRef(0);
  const frameRef = useRef<HopFrame>({ pos: 0, lift: 0 });
  const cancel = useRef<() => void>(() => undefined);
  const timer = useRef(0);

  const setF = (f: HopFrame): void => {
    frameRef.current = f;
    setFrame(f);
  };

  const speakPrompt = (p: PresentedItem): void => {
    if (!profile.settings.voice) return;
    const it = p.item;
    const pr = it.prompt;
    if (pr.kind === 'word') speaker.sayText(spokenPrompt(it, locale), locale);
    else if (pr.kind === 'custom') {
      const v = customVoice(it);
      if (v) speaker.say(v.key, v.params ?? {}, locale);
    }
    else if (pr.kind === 'expr' && pr.expr.k === 'op') {
      const a = pr.expr.a.k === 'num' ? pr.expr.a.v : 0;
      const b = pr.expr.b.k === 'num' ? pr.expr.b.v : 0;
      if (pr.rhs && pr.rhs.k === 'num') speaker.say('voice.bond', { a, total: pr.rhs.v }, locale);
      else speaker.say(({ '+': 'voice.add', '-': 'voice.sub', '*': 'voice.mul', '/': 'voice.div' } as const)[pr.expr.op], { a, b }, locale);
    } else if (pr.kind === 'locate') speaker.say('voice.locate', { n: pr.target }, locale);
    else if (pr.kind === 'groups') speaker.say('voice.groups', { n: pr.groups, size: pr.size }, locale);
    else if (pr.kind === 'count') speaker.say('voice.count', {}, locale);
    else speaker.say('voice.blocks', {}, locale);
  };

  const load = (): void => {
    cancel.current();
    window.clearTimeout(timer.current);
    const p = nextItem();
    if (!p) {
      props.onFinished();
      return;
    }
    setCur(p);
    setPhase('input');
    logical.current = p.item.line.start;
    setF({ pos: p.item.line.start, lift: 0 });
    setHops(0);
    setTyped('');
    setPick(null);
    setRes(null);
    setTrail([]);
    setGhost(null);
    setInvalid(false);
    shownAt.current = performance.now();
    props.onFeedback?.(false);
    props.onItemShown?.(p);
    if (band.audio === 'always') speakPrompt(p);
  };

  useEffect(() => {
    load();
    return () => {
      cancel.current();
      window.clearTimeout(timer.current);
      speaker.stop();
    };
  }, []);

  // Language switched mid-item: same item, re-rendered (and re-spoken for pre-readers).
  useEffect(() => {
    if (cur && band.audio === 'always' && phase === 'input') speakPrompt(cur);
  }, [locale]);

  // Hint ladder: Bands B/C, typed answers, never in timed Sprint runs.
  const hints = useHintLadder(cur, {
    enabled: flag('hints') && band.id !== 'A' && !props.fastFeedback && cur?.item.answer.tolerance === undefined,
    waiting: phase === 'input',
    invalid,
    activity: typed,
    pid: profile.id,
  });

  if (!cur || !session) return null;
  const item = cur.item;
  const line = item.line;
  const isEstimate = item.answer.tolerance !== undefined;
  const usesHops = band.input === 'hops';
  const answerValue = toNumber(item.answer.value);
  const glowTarget = line.answerMode === 'count' ? line.flag ?? null : answerValue;

  // ── Band A input: hop buttons and pad taps ─────────────────────────────
  const moveTo = (to: number, counted: boolean): void => {
    unlockAudio();
    const target = clampTo(to, line.min, line.max);
    if (target === logical.current) return;
    logical.current = target;
    if (counted) setHops((h) => h + 1);
    sfx('hop');
    cancel.current();
    cancel.current = animateHops([{ from: frameRef.current.pos, to: target }], setF, {
      msPerHop: 240,
      height: 28,
      onDone: () => sfx('land'),
    });
  };

  const onPadPick = (v: number): void => {
    if (phase === 'errorless') {
      if (v === glowTarget) {
        sfx('yes');
        load();
      }
      return;
    }
    if (phase !== 'input') return;
    moveTo(v, false);
  };

  // ── answering ──────────────────────────────────────────────────────────
  const afterLanding = (r: AnswerResult, landed: number): void => {
    if (r.grade.correct) {
      setPhase('correct');
      sfx('yes');
      const n = 1 + Math.floor(Math.random() * 4);
      setPraise(t(`play.praise${n}` as 'play.praise1'));
      if (band.audio !== 'off' && profile.settings.voice && band.id === 'A') speaker.say(`voice.praise${n}`, {}, locale);
      timer.current = window.setTimeout(load, props.fastFeedback ? 350 : band.id === 'A' ? 1300 : 900);
      return;
    }
    setPhase('wrong');
    props.onFeedback?.(true);
    sfx('soft');
    setGhost(landed);
    if (props.fastFeedback) {
      timer.current = window.setTimeout(load, 1600);
      return;
    }
    if (band.id === 'A' && profile.settings.voice) speaker.say('voice.lookTogether', {}, locale);
    const solHops = item.solution.filter((s): s is Extract<SolutionStep, { k: 'hop' }> => s.k === 'hop');
    const seq = usesHops ? unitHops(solHops) : solHops;
    timer.current = window.setTimeout(() => {
      setF({ pos: line.start, lift: 0 });
      logical.current = line.start;
      cancel.current = animateHops(seq, setF, {
        msPerHop: usesHops ? 300 : 520,
        height: usesHops ? 26 : 30,
        onHop: (i) => {
          setTrail(seq.slice(0, i + 1));
          sfx('hop');
        },
        onDone: () => {
          if (usesHops) {
            setPhase('errorless');
            if (profile.settings.voice) speaker.say('voice.tapGlow', {}, locale);
          } else setPhase('explain');
        },
      });
    }, 700);
  };

  const answer = (response: Response, input: InputMethod): void => {
    if (phase !== 'input') return;
    unlockAudio();
    const latency = performance.now() - shownAt.current;
    const r = submitAnswer(cur, response, { latencyMs: latency, hint: hints.tier > 0, hintTier: hints.tier, input, hops });
    if (r.grade.invalid) {
      setInvalid(true);
      sfx('soft');
      return;
    }
    setInvalid(false);
    setRes(r);
    props.onAnswered?.(r, latency);
    if (usesHops || response.kind === 'landed') {
      const landed = response.kind === 'landed' ? response.value : logical.current;
      if (response.kind === 'landed' && !usesHops) {
        setPhase('moving');
        cancel.current = animateHops([{ from: frameRef.current.pos, to: landed }], setF, { onDone: () => afterLanding(r, landed) });
      } else afterLanding(r, landed);
      return;
    }
    // Numpad: animate the child's own answer on the line first.
    const given = toNumber(parseKey(r.grade.given));
    setPhase('moving');
    if (line.answerMode === 'count') {
      const size = line.hopSize ?? 1;
      const n = Math.max(0, Math.min(20, Math.round(given)));
      const seq = Array.from({ length: n }, (_, i) => ({ from: line.start + i * size, to: clampTo(line.start + (i + 1) * size, line.min, line.max) }));
      const landedAt = seq.length ? seq[seq.length - 1]!.to : line.start;
      cancel.current = animateHops(seq, setF, { msPerHop: 200, height: 20, onHop: () => sfx('hop'), onDone: () => afterLanding(r, landedAt) });
    } else {
      const to = clampTo(given, line.min, line.max);
      sfx('hop');
      cancel.current = animateHops([{ from: line.start, to }], setF, { msPerHop: 520, height: 40, onDone: () => afterLanding(r, to) });
    }
  };

  const submit = (raw?: string): void => {
    if (usesHops) answer({ kind: 'landed', value: logical.current, hops }, hops > 0 ? 'hops' : 'tap');
    else if (isEstimate) {
      if (pick !== null) answer({ kind: 'landed', value: pick }, 'tap');
    } else {
      const v = raw ?? typed;
      if (v) answer({ kind: 'typed', raw: v }, 'typed');
    }
  };

  // Live magnitude preview while typing (land items only; never for count items, which it would give away).
  const typedValue = (() => {
    if (!typed || line.answerMode !== 'land' || isEstimate) return null;
    const v = Number(typed.replace('−', '-').replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  })();

  const firstPresented = session.engine.stats.firstPresented;
  const planned = session.engine.planned;
  const sayLines = item.solution.filter((s): s is Extract<SolutionStep, { k: 'say' }> => s.k === 'say');
  const shownLines = band.feedback === 'worked' ? sayLines : sayLines.slice(0, 4);
  const conv = getLocale(locale).numbers;

  const lineProps = {
    line,
    locale,
    pos: frame.pos,
    lift: frame.lift,
    look,
    ghost,
    glow: phase === 'errorless' || phase === 'explain' ? glowTarget : null,
    trail: trail.length || phase !== 'input' ? trail : hints.trail,
    mood: (phase === 'correct' ? 'happy' : phase === 'wrong' || phase === 'errorless' ? 'think' : 'idle') as 'happy' | 'think' | 'idle',
  };

  return (
    <div class={`play phase-${phase}`}>
      <header class="play-head">
        <button type="button" class="icon-btn" aria-label={t('play.exit')} onClick={props.onExit}>
          <Icon name="close" />
        </button>
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={planned} aria-valuenow={firstPresented} aria-label={t('play.progress', { n: firstPresented, total: planned })}>
          <div class="progress-fill" style={{ width: `${Math.min(100, (firstPresented / planned) * 100)}%` }} />
        </div>
        {band.audio !== 'off' && (
          <button type="button" class="icon-btn" aria-label={t('common.speaker')} onClick={() => speakPrompt(cur)}>
            <Icon name="speaker" />
          </button>
        )}
        <LangToggle />
      </header>
      {props.headerExtra}

      <section class="prompt" aria-live="polite">
        {cur.attempt > 1 && <span class="badge">{t('play.again')}</span>}
        <PromptVisual item={item} locale={locale} label={promptText(item, locale, profile.band)} bandA={band.id === 'A'} />
        {band.id !== 'A' && <p class="prompt-text">{promptText(item, locale, profile.band)}</p>}
        <HintText h={hints} locale={locale} band={profile.band} />
      </section>

      <section class="line-wrap">
        {usesHops ? (
          <PadsLine {...lineProps} pickable={phase === 'input' || phase === 'errorless'} onPick={onPadPick} />
        ) : (
          <RulerLine {...lineProps} preview={isEstimate ? pick : typedValue} pickable={isEstimate && phase === 'input'} onPick={setPick} />
        )}
        {usesHops && hops > 0 && phase === 'input' && (
          <div class="hop-count" aria-live="polite">
            {t('play.hops', { n: hops })}
          </div>
        )}
      </section>

      <section class="feedback" aria-live="assertive">
        {phase === 'correct' && <p class="praise">{praise}</p>}
        {invalid && <p class="invalid">{t('play.invalid')}</p>}
        {isEstimate && phase === 'correct' && item.answer.tolerance && (
          <p class="note">{t('play.estimateOk', { tol: item.answer.tolerance })}</p>
        )}
        {phase === 'explain' && res && (
          <div class="explain">
            <h2>{t('play.lookTogether')}</h2>
            <p>
              {line.answerMode === 'count' || ghost === null
                ? t('play.answerIs', { answer: answerText(item, locale) })
                : t('play.youLanded', { given: numberText(ghost, locale), answer: answerText(item, locale) })}
            </p>
            {shownLines.map((s) => (
              <p class="step">{solutionText(s, locale, profile.band)}</p>
            ))}
            {res.grade.misconception && <p class="tip">{t.dyn(`mis.${res.grade.misconception}.tip`)}</p>}
            {res.willReturn && <p class="note">{t('play.comesBack')}</p>}
          </div>
        )}
        {phase === 'wrong' && props.fastFeedback && <p class="note">{t('play.answerIs', { answer: answerText(item, locale) })}</p>}
      </section>

      <section class="controls">
        {phase === 'explain' ? (
          <button type="button" class="btn primary big" onClick={load}>
            {t('play.gotIt')}
          </button>
        ) : usesHops ? (
          <div class="hop-controls">
            {line.steps.map((s) => (
              <div class="hop-pair">
                <button type="button" class="hop-btn back" disabled={phase !== 'input'} aria-label={t('play.hopBack', { n: s })} onClick={() => moveTo(logical.current - s, true)}>
                  <Icon name="arrowL" size={28} />
                  <span>{numberText(s, locale)}</span>
                </button>
                <button type="button" class="hop-btn fwd" disabled={phase !== 'input'} aria-label={t('play.hopForward', { n: s })} onClick={() => moveTo(logical.current + s, true)}>
                  <span>{numberText(s, locale)}</span>
                  <Icon name="arrowR" size={28} />
                </button>
              </div>
            ))}
            <button type="button" class="btn go big" disabled={phase !== 'input'} aria-label={t('play.done')} onClick={() => submit()}>
              <Icon name="check" size={40} />
            </button>
          </div>
        ) : isEstimate ? (
          <div class="estimate-controls">
            <p class="note">{t('play.tapLine')}</p>
            <button type="button" class="btn primary big" disabled={pick === null || phase !== 'input'} onClick={() => submit()}>
              {t('play.hop')}
            </button>
          </div>
        ) : (
          <>
            {phase === 'input' && <HintButton h={hints} t={t} />}
            <div class="typed" aria-live="polite" aria-label={t('play.typeNumber')}>
              {typed || <span class="placeholder">{t('play.typeNumber')}</span>}
            </div>
            <Numpad
              value={typed}
              resetKey={`${item.key}#${cur.attempt}`}
              onChange={(v) => {
                setTyped(v);
                setInvalid(false);
              }}
              onSubmit={submit}
              decimal={conv.decimal}
              allowDecimal={!Number.isInteger(answerValue)}
              allowNegative={line.min < 0}
              submitLabel={t('play.hop')}
              labels={{ backspace: t('play.backspace'), negative: t('play.negative') }}
              disabled={phase !== 'input'}
            />
          </>
        )}
      </section>
    </div>
  );
}

function PromptVisual({ item, locale, label, bandA }: { item: Item; locale: string; label: string; bandA: boolean }): JSX.Element | null {
  const p = item.prompt;
  switch (p.kind) {
    case 'count':
      return <Dots count={p.count} layout={p.layout} label={label} />;
    case 'blocks':
      return <Blocks hundreds={p.hundreds} tens={p.tens} ones={p.ones} label={label} />;
    case 'groups':
      return <Groups groups={p.groups} size={p.size} label={label} />;
    case 'expr':
      return <ExprView expr={p.expr} rhs={p.rhs} locale={locale} />;
    case 'locate':
      return bandA ? <div class="big-num">{numberText(p.target, locale)}</div> : null;
    case 'word':
      return null;
    case 'custom':
      return null;
  }
}
