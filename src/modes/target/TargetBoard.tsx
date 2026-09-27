/**
 * The Bands B/C Target board: tap a card, tap a sign, tap another card, and
 * the two merge into a new card. That builds an expression tree without
 * typing a single bracket; undo and "start again" are always there.
 *
 * A ruler from 0 to twice the target (from 2·target to 0 for a negative one)
 * shows the running value against a flag at the target, so a miss shows how
 * far off it is. The item ends only in a solve (graded by the target.expr
 * checker from the built expression) or in "show me" (not solved). After a
 * solve the child may look for other ways: each new one is logged as an
 * event, and the solver's list of ways can be opened.
 *
 * Hints (flag `hints`) follow the best solution: tier 1 names an operator,
 * tier 2 gives the first step, tier 3 two steps; a solve after tier k earns
 * credit 1 − 0.25·k.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { submitAnswer, toast } from '../../app/actions';
import { flag } from '../../app/services';
import { recordTargetWay } from '../../app/targetActions';
import { play as sfx, unlockAudio } from '../../audio/sfx';
import type { BandConfig } from '../../bands/types';
import type { PresentedItem } from '../../core/engine/session';
import type { targetData } from '../../core/items/generators/makeIt';
import { abs, eq, isInteger, key, rat, sub, toNumber, type Rational } from '../../core/rational';
import { applyOp, canonicalKey, evaluate, leaf, node, parseRepr, toRepr, type TargetOp, type TExpr } from '../../core/target/expr';
import { targetHints, type TargetHint, type TargetStep } from '../../core/target/hints';
import type { LocaleId } from '../../core/types';
import type { MessageParams } from '../../i18n/format';
import type { MessageKey } from '../../i18n/i18n';
import { promptText } from '../../i18n/render';
import { animateHops, type HopFrame } from '../../ui/anim';
import { Icon } from '../../ui/components/Icon';
import { RulerLine, type HopperLook } from '../../ui/components/NumberLine';
import { useT } from '../../ui/hooks';
import { OP_NAME, opGlyph, valueText } from './format';
import { Expr, Num } from './Num';
import { OtherWays } from './OtherWays';

export type TargetData = NonNullable<ReturnType<typeof targetData>>;

interface Card {
  id: number;
  v: Rational;
  e: TExpr;
  merged: boolean;
}

interface Board {
  cards: Card[];
  /** The card the last merge made (the ruler follows it). */
  last: number | null;
}

type Phase = 'play' | 'solved' | 'more' | 'revealed';
type Msg = { key: MessageKey; params?: MessageParams; tone?: 'good' | 'note' };

export interface BoardProps {
  presented: PresentedItem;
  data: TargetData;
  locale: LocaleId;
  band: BandConfig;
  look: HopperLook;
  onNext: () => void;
  /** An extra distinct way was found (for the results line). */
  onExtraWay: () => void;
}

function dealt(data: TargetData): Board {
  return { cards: data.cards.map((c, i) => ({ id: i, v: rat(c), e: leaf(c), merged: false })), last: null };
}

function Step({ s, locale }: { s: TargetStep; locale: LocaleId }): JSX.Element {
  return <Expr e={node(s.op, leaf(s.a), leaf(s.b))} locale={locale} result={s.r} />;
}

function HintBox({ hint, locale }: { hint: TargetHint; locale: LocaleId }): JSX.Element {
  const t = useT();
  if (hint.tier === 1) {
    return (
      <p class="hint-text">
        {t('target.hint.op')} <span class="thint-op">{opGlyph(hint.op, locale)}</span>
      </p>
    );
  }
  return (
    <div class="hint-text thint">
      {hint.steps.map((s, i) => (
        <p>
          <span>{t(i === 0 ? 'target.hint.start' : 'target.hint.then')}</span> <Step s={s} locale={locale} />
        </p>
      ))}
      {hint.next && (
        <p>
          <span>{t(hint.steps.length ? 'target.hint.then' : 'target.hint.start')}</span>{' '}
          <span class="texpr" dir="ltr">
            <Num v={hint.next.a} locale={locale} />
            <span class="texpr-op">{opGlyph(hint.next.op, locale)}</span>
            <span class="texpr-op">…</span>
          </span>
        </p>
      )}
    </div>
  );
}

export function TargetBoard({ presented, data, locale, band, look, onNext, onExtraWay }: BoardProps): JSX.Element {
  const t = useT();
  const item = presented.item;
  const target = rat(data.target);
  const [board, setBoard] = useState<Board>(() => dealt(data));
  const [history, setHistory] = useState<Board[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [op, setOp] = useState<TargetOp | null>(null);
  const [phase, setPhase] = useState<Phase>('play');
  const [msg, setMsg] = useState<Msg | null>(null);
  const [tier, setTier] = useState(0);
  const [found, setFound] = useState<ReadonlyMap<string, TExpr>>(new Map());
  const [shown, setShown] = useState<TExpr | null>(null);
  const [showWays, setShowWays] = useState(false);
  const [praise, setPraise] = useState('');
  const [frame, setFrame] = useState<HopFrame>({ pos: 0, lift: 0 });
  const frameRef = useRef<HopFrame>({ pos: 0, lift: 0 });
  const cancel = useRef<() => void>(() => undefined);
  const nextId = useRef(data.cards.length);
  const shownAt = useRef(performance.now());

  const best = useMemo(() => parseRepr(data.ways[0] ?? ''), [data]);
  const hints = useMemo(() => (best ? targetHints(best) : []), [best]);
  const hintsOn = flag('hints') && band.id !== 'A' && hints.length > 0;

  useEffect(() => () => cancel.current(), []);

  const moveTo = (v: number): void => {
    const to = Math.min(item.line.max, Math.max(item.line.min, v));
    if (to === frameRef.current.pos) return;
    cancel.current();
    cancel.current = animateHops(
      [{ from: frameRef.current.pos, to }],
      (f) => {
        frameRef.current = f;
        setFrame(f);
      },
      { msPerHop: 420, height: 26 },
    );
  };

  const reset = (to: Board = dealt(data)): void => {
    setBoard(to);
    setSel(null);
    setOp(null);
    const lastCard = to.cards.find((c) => c.id === to.last);
    moveTo(lastCard ? toNumber(lastCard.v) : 0);
  };

  const missMessage = (v: Rational): Msg => {
    const params = { value: valueText(v, t.locale), target: valueText(target, t.locale) };
    const d = sub(v, target);
    if (!isInteger(d)) return { key: 'target.missOther', params };
    return { key: d.n > 0 ? 'target.missOver' : 'target.missUnder', params: { ...params, d: valueText(abs(d), t.locale) } };
  };

  const solved = (e: TExpr): void => {
    const canon = canonicalKey(e) ?? '';
    if (phase === 'play') {
      const res = submitAnswer(
        presented,
        { kind: 'built', value: evaluate(e), repr: toRepr(e) },
        { latencyMs: performance.now() - shownAt.current, hint: tier > 0, hintTier: tier, input: 'tap', hops: 0 },
      );
      if (!res.grade.correct) return; // The checker disagrees with the board: never expected; keep playing.
      const n = 1 + Math.floor(Math.random() * 4);
      setPraise(t(`play.praise${n}` as 'play.praise1'));
      setMsg(null);
    } else {
      if (found.has(canon)) {
        setMsg({ key: 'target.sameWay', tone: 'note' });
        window.setTimeout(() => reset(), 900);
        return;
      }
      const n = found.size + 1;
      const ids = recordTargetWay(item.key, canon, toRepr(e), n);
      if (ids.length) toast(t.dyn(`ach.${ids[0]}.name`));
      onExtraWay();
      setMsg({ key: 'target.newWay', params: { n }, tone: 'good' });
    }
    sfx('yes');
    setFound(new Map([...found, [canon, e]]));
    setShown(e);
    setPhase('solved');
  };

  const merge = (aId: number, o: TargetOp, bId: number): void => {
    const a = board.cards.find((c) => c.id === aId);
    const b = board.cards.find((c) => c.id === bId);
    if (!a || !b) return;
    const r = applyOp(o, a.v, b.v);
    const refuse = (key: MessageKey): void => {
      sfx('soft');
      setMsg({ key, tone: 'note' });
      setOp(null);
    };
    if (!r) return refuse('target.divZero');
    if (!data.allowFractionIntermediates && !isInteger(r)) return refuse('target.wholeOnly');
    if (!data.allowNegativeIntermediates && r.n < 0) return refuse('target.noNegative');
    const card: Card = { id: nextId.current++, v: r, e: node(o, a.e, b.e), merged: true };
    const cards = board.cards.flatMap((c) => (c.id === aId ? [card] : c.id === bId ? [] : [c]));
    setHistory([...history, board]);
    setBoard({ cards, last: card.id });
    setSel(null);
    setOp(null);
    sfx('hop');
    moveTo(toNumber(r));
    const hit = eq(r, target);
    if (hit && (!data.mustUseAll || cards.length === 1)) solved(card.e);
    else if (hit) setMsg({ key: 'target.useAll', params: { target: valueText(target, t.locale) }, tone: 'note' });
    else setMsg(cards.length === 1 ? { ...missMessage(r), tone: 'note' } : null);
  };

  const tapCard = (c: Card): void => {
    if (phase !== 'play' && phase !== 'more') return;
    unlockAudio();
    if (sel !== null && op !== null && sel !== c.id) {
      merge(sel, op, c.id);
      return;
    }
    sfx('tap');
    setMsg(null);
    const next = sel === c.id ? null : c.id;
    setSel(next);
    setOp(null);
    if (next !== null) moveTo(toNumber(c.v));
  };

  const tapOp = (o: TargetOp): void => {
    if (phase !== 'play' && phase !== 'more') return;
    unlockAudio();
    if (sel === null) {
      setMsg({ key: 'target.pickFirst', tone: 'note' });
      return;
    }
    sfx('tap');
    setMsg(null);
    setOp(op === o ? null : o);
  };

  const undo = (): void => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(history.slice(0, -1));
    setMsg(null);
    reset(prev);
  };

  const restart = (): void => {
    setHistory([]);
    setMsg(null);
    reset();
  };

  const reveal = (): void => {
    if (phase !== 'play' || !best) return;
    submitAnswer(
      presented,
      { kind: 'built', value: null, repr: '', data: { reveal: 1 } },
      { latencyMs: performance.now() - shownAt.current, hint: tier > 0, hintTier: tier, revealed: true, input: 'tap', hops: 0 },
    );
    setMsg(null);
    setSel(null);
    setOp(null);
    setShown(best);
    setPhase('revealed');
    moveTo(data.target);
  };

  const another = (): void => {
    setPhase('more');
    setShowWays(false);
    setHistory([]);
    setMsg({ key: 'target.anotherPrompt', params: { target: valueText(target, t.locale) } });
    reset();
  };

  const playing = phase === 'play' || phase === 'more';
  const hint = tier > 0 ? hints[tier - 1] : undefined;

  return (
    <>
      <section class="prompt target-prompt">
        <p class="target-goal">{promptText(item, locale, band.id)}</p>
        {phase === 'play' && history.length === 0 && sel === null && !hint && <p class="muted small">{t('target.howTo')}</p>}
        {phase === 'play' && hint && <HintBox hint={hint} locale={locale} />}
      </section>

      <section class="line-wrap">
        <RulerLine line={item.line} locale={locale} pos={frame.pos} lift={frame.lift} look={look} mood={phase === 'solved' ? 'happy' : 'idle'} />
      </section>

      <section class={`tcards n${board.cards.length}`} aria-live="polite">
        {board.cards.map((c) => (
          <button
            type="button"
            class={`tcard${c.merged ? ' merged' : ''}${c.id === sel ? ' sel' : ''}${c.id === board.last ? ' last' : ''}`}
            data-v={key(c.v)}
            aria-pressed={c.id === sel}
            aria-label={t('target.card', { value: valueText(c.v, t.locale) })}
            disabled={!playing}
            onClick={() => tapCard(c)}
          >
            <span class="tcard-v">
              <Num v={c.v} locale={locale} />
            </span>
            {c.merged && (
              <span class="tcard-expr">
                <Expr e={c.e} locale={locale} />
              </span>
            )}
          </button>
        ))}
      </section>

      <section class="feedback" aria-live="assertive">
        {phase === 'solved' && <p class="praise">{praise}</p>}
        {msg && <p class={`tmsg ${msg.tone ?? ''}`}>{t(msg.key, msg.params)}</p>}
      </section>

      <section class="controls">
        {playing ? (
          <>
            <div class="tops" role="group">
              {data.ops.map((o) => (
                <button type="button" class={`top${op === o ? ' on' : ''}`} data-op={o} aria-pressed={op === o} aria-label={t(OP_NAME[o])} onClick={() => tapOp(o)}>
                  {opGlyph(o, locale)}
                </button>
              ))}
            </div>
            <div class="ttools">
              <button type="button" class="btn small" disabled={!history.length} onClick={undo}>
                <Icon name="undo" size={18} /> {t('target.undo')}
              </button>
              <button type="button" class="btn small" disabled={!history.length && sel === null} onClick={restart}>
                <Icon name="restart" size={18} /> {t('target.reset')}
              </button>
              {phase === 'play' && hintsOn && tier < hints.length && (
                <button type="button" class="btn small ghost thint-btn" onClick={() => setTier(tier + 1)}>
                  <Icon name="hint" size={18} /> {t('play.hint')}
                </button>
              )}
              {phase === 'play' ? (
                <button type="button" class="btn small ghost tshow" onClick={reveal}>
                  <Icon name="eye" size={18} /> {t('target.showMe')}
                </button>
              ) : (
                <button type="button" class="btn small tnext-small" onClick={onNext}>
                  {t('target.next')}
                </button>
              )}
            </div>
          </>
        ) : (
          <div class="tdone">
            {phase === 'revealed' && <p class="tdone-title">{t('target.reveal')}</p>}
            {shown && (
              <p class="tdone-expr">
                <Expr e={shown} locale={locale} result={target} />
              </p>
            )}
            <div class="row wrap center-row">
              {phase === 'solved' && (
                <button type="button" class="btn tanother" onClick={another}>
                  <Icon name="cards" size={20} /> {t('target.another')}
                </button>
              )}
              <button type="button" class={`btn tways-btn${showWays ? ' on' : ''}`} aria-pressed={showWays} onClick={() => setShowWays(!showWays)}>
                {t('target.otherWays')}
              </button>
            </div>
            {showWays && <OtherWays ways={data.ways} total={data.total} found={new Set(found.keys())} target={target} locale={locale} />}
            <button type="button" class="btn primary big tnext" onClick={onNext}>
              {t('target.next')}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
