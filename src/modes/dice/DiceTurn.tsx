/**
 * One player's turn, in that player's language and theme.
 *
 *   A  roll one die of dots → count on with the hop buttons (or tap a pad)
 *      from the frog's pad; a wrong landing gets the errorless replay
 *      (count the hops together, tap the glowing pad). No text needed.
 *   B  roll two dice → pick + − × (only unlocked operators; ladders ahead
 *      are listed so the choice can aim for one) → type the fact.
 *   C  roll a number die and a sign die → type the integer sum.
 *
 * Right or wrong, the token then hops by the dice on the board and climbs
 * any ladder: the move never depends on the answer or on the time taken.
 * No timers: the next player comes only when this one taps "next".
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { answerTurn, chooseOption, endTurn, quitMatch, rollTurn } from '../../app/diceActions';
import { speaker } from '../../app/services';
import { useStore } from '../../app/store';
import { play as sfx, unlockAudio } from '../../audio/sfx';
import { getBand } from '../../bands/registry';
import type { PendingTurn } from '../../core/dice';
import type { Response } from '../../core/items/grade';
import type { Expr, LineSpec } from '../../core/items/types';
import { toNumber } from '../../core/rational';
import { makeT } from '../../i18n/i18n';
import { getLocale } from '../../i18n/locales';
import { exprTokens, numberText, tokensText } from '../../i18n/render';
import { animateHops, unitHops, type HopFrame } from '../../ui/anim';
import { Icon } from '../../ui/components/Icon';
import { PadsLine } from '../../ui/components/NumberLine';
import { Numpad } from '../../ui/components/Numpad';
import { lookFor } from '../../ui/hooks';
import { Avatar } from '../../ui/screens/Profiles';
import { DiceBoard, type TokenAnim } from './DiceBoard';
import { DiceFaces, DicePage, PlayerLang } from './parts';
import type { DiceState } from './state';

type APhase = 'input' | 'wrong' | 'errorless' | 'done';

const opExpr = (a: number, op: '+' | '-' | '*', b: number): Expr => ({ k: 'op', op, a: { k: 'num', v: a }, b: { k: 'num', v: b } });

/** "6 − 2 = [ ]": the answer box shows what is being typed, then the answer once given. */
function ExprAnswer({ expr, locale, shown }: { expr: Expr; locale: string; shown: string | null }): JSX.Element {
  return (
    <div class="expr dice-expr" dir="ltr" aria-live="polite">
      {exprTokens(expr, locale).map((tk) => (tk.t === 'blank' ? <span class="expr-blank">?</span> : <span class={`expr-${tk.t}`}>{tk.s}</span>))}
      <span class="expr-op">=</span>
      <span class={`expr-blank dice-answer${shown ? ' filled' : ''}`}>{shown ?? '?'}</span>
    </div>
  );
}

/** A small ladder (the B lane's ladders), for the "ladders ahead" row. */
function LadderIcon(): JSX.Element {
  return (
    <svg class="ladder-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10" />
    </svg>
  );
}

export function DiceTurn({ d }: { d: DiceState }): JSX.Element | null {
  const profiles = useStore((s) => s.profiles);
  const match = d.match!;
  const turn = d.turn;
  const player = match.players[turn.player]!;
  const p = profiles.find((x) => x.id === player.id);
  const locale = p?.locale ?? 'mk';
  const bandId = p?.band ?? player.band;
  const t = useMemo(() => makeT(locale, bandId), [locale, bandId]);
  const band = getBand(bandId);
  const lane = match.lanes[turn.player]!;
  const board = lane.board;
  const answered = turn.answered;
  const from = answered ? answered.from : lane.position;
  // The roll stays on screen after the move (the match clears `pending` once it is played).
  const lastPending = useRef<PendingTurn | null>(null);
  if (match.pending) lastPending.current = match.pending;
  const pending = match.pending ?? (answered ? lastPending.current : null);
  const presented = turn.presented;
  const target = presented ? toNumber(presented.item.answer.value) : null;

  const [anim, setAnim] = useState<TokenAnim | null>(null);
  const [moved, setMoved] = useState(false);
  const [aPhase, setAPhase] = useState<APhase>('input');
  const [frame, setFrameState] = useState<HopFrame>({ pos: from, lift: 0 });
  const [hops, setHops] = useState(0);
  const [trail, setTrail] = useState<Array<{ from: number; to: number }>>([]);
  const [ghost, setGhost] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [praise, setPraise] = useState('');
  const logical = useRef(from);
  const frameRef = useRef<HopFrame>({ pos: from, lift: 0 });
  const cancel = useRef<() => void>(() => undefined);
  const shownAt = useRef(0);

  const setFrame = (f: HopFrame): void => {
    frameRef.current = f;
    setFrameState(f);
  };
  const say = (key: string): void => {
    if (p && band.audio === 'always' && p.settings.voice) speaker.say(key, {}, p.locale);
  };

  useEffect(() => {
    say('voice.dice.roll');
    return () => {
      cancel.current();
      speaker.stop();
    };
  }, []);

  // A new item (a roll, or another operator chosen): latency is logged from here; it never moves anything.
  useEffect(() => {
    if (!presented) return;
    shownAt.current = performance.now();
    setTyped('');
    setInvalid(false);
  }, [presented?.item.key]);

  // Once the answer is in (and, in A, the errorless step is done): the token hops by the dice, then climbs.
  useEffect(() => {
    if (!answered || moved || (band.id === 'A' && aPhase !== 'done')) return;
    const { move } = answered;
    const end = move.lane.position;
    const land = move.climbed ? move.climbed.foot : end;
    const seq = [{ from, to: land }, ...(move.climbed ? [{ from: land, to: end }] : [])].filter((h) => h.from !== h.to);
    cancel.current();
    setAnim({ player: turn.player, pos: from, lift: 0 });
    cancel.current = animateHops(seq, (f) => setAnim({ player: turn.player, pos: f.pos, lift: f.lift }), {
      msPerHop: 520,
      height: 30,
      onHop: (i) => sfx(i === 0 ? 'land' : 'unlock'),
      onDone: () => {
        setAnim(null);
        setMoved(true);
        if (!match.over) say('voice.dice.pass');
      },
    });
  }, [answered, aPhase]);

  if (!p) return null;

  const cheer = (): void => {
    const n = 1 + Math.floor(Math.random() * 4);
    setPraise(t(`play.praise${n}` as 'play.praise1'));
    sfx('yes');
    if (band.id === 'A' && p.settings.voice) speaker.say(`voice.praise${n}`, {}, p.locale);
  };

  const onRoll = (): void => {
    unlockAudio();
    sfx('tap');
    rollTurn();
  };

  const submit = (response: Response, input: 'hops' | 'tap' | 'typed', hopCount: number): ReturnType<typeof answerTurn> => {
    unlockAudio();
    const latencyMs = performance.now() - shownAt.current;
    // Hold the board token where it was until the move is shown.
    setAnim({ player: turn.player, pos: from, lift: 0 });
    const res = answerTurn(response, { latencyMs, hint: false, input, hops: hopCount });
    if (!res || res.grade.invalid) setAnim(null);
    return res;
  };

  // ── Band A: count on with hops ─────────────────────────────────────────
  const padsLine: LineSpec = { min: board.start, max: board.finish, start: from, major: 5, minor: 1, labelEvery: 1, steps: [1], answerMode: 'land' };
  const moveTo = (to: number, counted: boolean): void => {
    unlockAudio();
    const next = Math.min(board.finish, Math.max(board.start, to));
    if (next === logical.current) return;
    logical.current = next;
    if (counted) setHops((h) => h + 1);
    sfx('hop');
    cancel.current();
    cancel.current = animateHops([{ from: frameRef.current.pos, to: next }], setFrame, { msPerHop: 240, height: 28, onDone: () => sfx('land') });
  };
  const submitA = (): void => {
    if (aPhase !== 'input' || !presented || answered || target === null) return;
    const landed = logical.current;
    const res = submit({ kind: 'landed', value: landed, hops }, hops > 0 ? 'hops' : 'tap', hops);
    if (!res || res.grade.invalid) return;
    if (res.grade.correct) {
      setAPhase('done');
      cheer();
      return;
    }
    // Errorless: replay the right count from the start pad, then the child taps the glowing pad.
    setAPhase('wrong');
    sfx('soft');
    setGhost(landed);
    say('voice.lookTogether');
    const seq = unitHops([{ from, to: target }]);
    cancel.current();
    setFrame({ pos: from, lift: 0 });
    logical.current = from;
    cancel.current = animateHops(seq, setFrame, {
      msPerHop: 300,
      height: 26,
      onHop: (i) => {
        setTrail(seq.slice(0, i + 1));
        sfx('hop');
      },
      onDone: () => {
        setAPhase('errorless');
        say('voice.tapGlow');
      },
    });
  };
  const onPadPick = (v: number): void => {
    if (aPhase === 'errorless') {
      if (v === target) {
        sfx('yes');
        logical.current = v;
        setAPhase('done');
      }
      return;
    }
    if (aPhase === 'input' && presented && !answered) moveTo(v, false);
  };

  // ── Bands B and C: the numpad ──────────────────────────────────────────
  const submitTyped = (raw: string): void => {
    if (!presented || answered) return;
    const res = submit({ kind: 'typed', raw }, 'typed', 0);
    if (!res) return;
    if (res.grade.invalid) {
      setInvalid(true);
      sfx('soft');
      return;
    }
    setInvalid(false);
    if (res.grade.correct) cheer();
    else sfx('soft');
  };

  const rolled = band.id === 'B' ? !!pending : !!presented || !!answered;
  const options = pending?.options ?? [];
  const chosen = turn.choice !== null ? options[turn.choice] ?? null : null;
  const prompt = presented?.item.prompt;
  const expr = prompt?.kind === 'expr' ? prompt.expr : null;
  const exprText = expr ? tokensText(exprTokens(expr, locale)) : '';
  const solLine =
    answered && target !== null && band.id !== 'A'
      ? t.dyn(band.id === 'B' ? 'sol.dice.hop' : 'sol.dice.land', { expr: exprText, r: target })
      : null;
  const notes = moved && answered ? answered.move.notes.filter((n) => !(band.id === 'C' && n.key === 'dice.note.bounce')) : [];
  const ahead = band.id === 'B' ? board.ladders.filter((l) => l.foot > from) : [];
  const conv = getLocale(locale).numbers;
  const nextLabel = match.over ? t('common.continue') : t('dice.next');

  return (
    <DicePage p={p} class={`dice-turn band-${band.id}`}>
      <header class="dice-head">
        <button type="button" class="icon-btn" aria-label={t('dice.quit')} onClick={quitMatch}>
          <Icon name="close" />
        </button>
        <span class="dice-who">
          <Avatar p={p} size={40} />
        </span>
        <span class="grow" />
        {band.audio === 'always' && (
          <button type="button" class="icon-btn" aria-label={t('common.speaker')} onClick={() => say(moved ? 'voice.dice.pass' : 'voice.dice.roll')}>
            <Icon name="speaker" />
          </button>
        )}
        <PlayerLang p={p} t={t} />
      </header>

      <DiceBoard match={match} profiles={profiles} active={turn.player} anim={anim} />

      <section class="dice-roll" aria-live="polite">
        {rolled && pending ? (
          <DiceFaces roll={pending.roll} t={t} />
        ) : (
          <button type="button" class="btn go roll-btn" aria-label={t('dice.roll')} onClick={onRoll}>
            <Icon name="dice" size={band.id === 'A' ? 56 : 30} />
            {band.id === 'A' ? null : <span>{t('dice.roll')}</span>}
          </button>
        )}
      </section>

      {band.id === 'A' ? (
        <>
          <section class="line-wrap">
            <PadsLine
              line={padsLine}
              locale={locale}
              pos={frame.pos}
              lift={frame.lift}
              look={lookFor(p)}
              ghost={ghost}
              glow={aPhase === 'errorless' ? target : null}
              trail={trail}
              pickable={(aPhase === 'input' && !!presented && !answered) || aPhase === 'errorless'}
              onPick={onPadPick}
              mood={aPhase === 'done' ? 'happy' : aPhase === 'wrong' || aPhase === 'errorless' ? 'think' : 'idle'}
            />
            {hops > 0 && aPhase === 'input' && (
              <div class="hop-count" aria-live="polite">
                {t('play.hops', { n: hops })}
              </div>
            )}
          </section>
          <section class="feedback" aria-live="assertive">
            {aPhase === 'done' && praise && <p class="praise">{praise}</p>}
            {notes.map((n) => (
              <p class="note dice-note">{t.dyn(n.key, n.params)}</p>
            ))}
          </section>
          <section class="controls">
            {moved ? (
              <button type="button" class="btn primary big dice-next" aria-label={nextLabel} onClick={endTurn}>
                <Icon name="arrowR" size={40} />
              </button>
            ) : (
              <div class="hop-controls">
                <div class="hop-pair">
                  <button type="button" class="hop-btn back" disabled={aPhase !== 'input' || !presented} aria-label={t('play.hopBack', { n: 1 })} onClick={() => moveTo(logical.current - 1, true)}>
                    <Icon name="arrowL" size={28} />
                    <span>{numberText(1, locale)}</span>
                  </button>
                  <button type="button" class="hop-btn fwd" disabled={aPhase !== 'input' || !presented} aria-label={t('play.hopForward', { n: 1 })} onClick={() => moveTo(logical.current + 1, true)}>
                    <span>{numberText(1, locale)}</span>
                    <Icon name="arrowR" size={28} />
                  </button>
                </div>
                <button type="button" class="btn go big" disabled={aPhase !== 'input' || !presented} aria-label={t('play.done')} onClick={submitA}>
                  <Icon name="check" size={40} />
                </button>
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          {band.id === 'B' && pending && (
            <section class="dice-choose">
              {options.length > 1 && turn.choice === null && <p class="dice-ask">{t('dice.choose')}</p>}
              <div class="chips op-chips" role="group" aria-label={t('dice.choose')}>
                {options.map((o, i) => (
                  <button type="button" class={`chip op-chip${turn.choice === i ? ' on' : ''}`} aria-pressed={turn.choice === i} disabled={!!answered} onClick={() => chooseOption(i)}>
                    {tokensText(exprTokens(opExpr(o.item.a, o.item.op, o.item.b), locale))}
                  </button>
                ))}
              </div>
              {ahead.length > 0 && (
                <div class="ladder-row" role="group" aria-label={t('dice.ladders')}>
                  <LadderIcon />
                  {ahead.map((l) => (
                    <span class="ladder-chip" role="img" aria-label={t('dice.ladder', { from: l.foot, to: l.top })}>
                      {numberText(l.foot, locale)}
                      <Icon name="arrowR" size={14} />
                      {numberText(l.top, locale)}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}
          {band.id === 'C' && chosen?.bounced && !moved && <p class="note dice-note">{t('dice.note.bounce')}</p>}
          {expr && (
            <section class="dice-prompt">
              <ExprAnswer expr={expr} locale={locale} shown={answered && target !== null ? numberText(target, locale) : typed || null} />
            </section>
          )}
          <section class="feedback" aria-live="assertive">
            {invalid && <p class="invalid">{t('play.invalid')}</p>}
            {answered?.res.grade.correct && praise && <p class="praise">{praise}</p>}
            {solLine && <p class="dice-sol">{solLine}</p>}
            {notes.map((n) => (
              <p class="note dice-note">{t.dyn(n.key, n.params)}</p>
            ))}
          </section>
          <section class="controls">
            {moved ? (
              <button type="button" class="btn primary big dice-next" onClick={endTurn}>
                <Icon name="arrowR" /> {nextLabel}
              </button>
            ) : (
              rolled && (
                <>
                  <Numpad
                    value={typed}
                    resetKey={presented ? `${presented.item.key}` : 'none'}
                    onChange={(v) => {
                      setTyped(v);
                      setInvalid(false);
                    }}
                    onSubmit={submitTyped}
                    decimal={conv.decimal}
                    allowDecimal={false}
                    allowNegative={band.id === 'C'}
                    submitLabel={t('play.hop')}
                    labels={{ backspace: t('play.backspace'), negative: t('play.negative') }}
                    disabled={!presented || !!answered}
                  />
                </>
              )
            )}
          </section>
        </>
      )}
    </DicePage>
  );
}
