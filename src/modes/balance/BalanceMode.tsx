/**
 * Balance (step 9b): solve an equation on a pan scale.
 *
 * The child composes a move (+, − or ÷ with an amount, a number or x-boxes)
 * and applies it to BOTH pans. A move that would break the balance, split a
 * weight, change nothing or (Band B) need a balloon is refused gently and
 * logged in the transcript; tapping a piece asks to take it off one pan only,
 * which the scale always refuses. When x stands alone, the x field unlocks
 * and the child types its value. The transcript (every tried move, refused
 * ones marked, undos, the value or "show me") is the answer: the balance.eq
 * checker replays it and never trusts this screen.
 *
 * Credit: y = 1 − 0.25 per refused unbalancing move and per hint tier
 * (`balanceY`), passed to the engine as the hint tier min(4, refusals +
 * tiers); "Show me" is a wrong attempt (y = 0) and the item returns later.
 * The time spent on the worked solution after a mistake is logged like
 * Hop's (feedbackTime.ts).
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { endSession, nextItem, submitAnswer } from '../../app/actions';
import { navigate } from '../../app/router';
import { flag } from '../../app/services';
import { getState, useStore } from '../../app/store';
import { play as sfx, unlockAudio } from '../../audio/sfx';
import { getBand } from '../../bands/registry';
import {
  applyMove,
  BALANCE_BLOCKED_KEYS,
  BALANCE_HINT_KEYS,
  BALANCE_HINT_THEN_KEYS,
  balanceHints,
  describeMove,
  isBlocked,
  isolatedValue,
  moveToken,
  parseMoveToken,
  readBalanceData,
  replayPath,
  solutionPath,
  startState,
  type BalanceMove,
  type BalanceState,
  type BlockReason,
  type Equation,
} from '../../core/balance';
import type { AnswerResult, PresentedItem } from '../../core/engine/session';
import type { SolutionStep } from '../../core/items/types';
import { key, toNumber, type Rational } from '../../core/rational';
import { getLocale } from '../../i18n/locales';
import { parseNumberInput } from '../../i18n/numbers';
import { numberText, solutionText } from '../../i18n/render';
import { LangToggle } from '../../ui/components/common';
import { Icon } from '../../ui/components/Icon';
import { Numpad } from '../../ui/components/Numpad';
import { useT } from '../../ui/hooks';
import { useFeedbackTime } from '../feedbackTime';
import { amountText, equationText, moveText, panText } from './format';
import { Scale } from './Scale';
import './balance.css';

type Phase = 'input' | 'correct' | 'explain';
type Op = 'add' | 'sub' | 'div';
interface Amount {
  n: number;
  term: 'x' | 'k';
}

/** Amounts worth offering: every number and x-term on the scale, plus 1 and x (and useful divisors for ÷). */
function suggestions(eq: Equation, op: Op, balloons: boolean): Amount[] {
  const out: Amount[] = [];
  const add = (n: number, term: 'x' | 'k'): void => {
    if (n !== 0 && !out.some((a) => a.n === n && a.term === term)) out.push({ n, term });
  };
  if (op === 'div') {
    for (const c of [eq.l.x, eq.r.x, eq.l.x - eq.r.x]) {
      if (Math.abs(c) > 1) add(Math.abs(c), 'k');
      if (balloons && c < 0) add(c, 'k');
    }
    add(2, 'k');
    if (balloons) add(-1, 'k');
    return out.slice(0, 6);
  }
  for (const k of [eq.l.k, eq.r.k].map(Math.abs).sort((a, b) => a - b)) add(k, 'k');
  for (const x of [eq.l.x, eq.r.x].map(Math.abs).sort((a, b) => a - b)) add(x, 'x');
  add(1, 'k');
  add(1, 'x');
  return out.slice(0, 6);
}

function toMove(op: Op, a: Amount): BalanceMove {
  return op === 'div' ? { op, n: a.n } : { op, term: a.term, n: a.n };
}

/** Which way a refused move tips the scale (the pan that would get heavier goes down). */
function tipFor(m: BalanceMove): 'left' | 'right' | null {
  if (!m.side || m.side === 'both' || m.op === 'div') return null;
  const heavier = m.op === 'add' ? m.n > 0 : m.n < 0;
  if (m.side === 'left') return heavier ? 'left' : 'right';
  return heavier ? 'right' : 'left';
}

export function BalanceMode(): JSX.Element {
  const onFinished = (): void => {
    endSession(true);
    navigate('/results', true);
  };
  const onExit = (): void => {
    const answered = getState().session?.firstAttempts ?? 0;
    endSession(false);
    navigate(answered > 0 ? '/results' : '/', true);
  };
  return <BalancePlay onFinished={onFinished} onExit={onExit} />;
}

function BalancePlay({ onFinished, onExit }: { onFinished: () => void; onExit: () => void }): JSX.Element | null {
  const profile = useStore((s) => s.profile)!;
  const session = useStore((s) => s.session);
  const t = useT();
  const band = getBand(profile.band);
  const locale = profile.locale;

  const [cur, setCur] = useState<PresentedItem | null>(null);
  const [stack, setStack] = useState<BalanceState[]>([]);
  const [tokens, setTokens] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<BlockReason | null>(null);
  const [tip, setTip] = useState<'left' | 'right' | null>(null);
  const [penalised, setPenalised] = useState(0);
  // The composer starts empty: the child chooses the operation and the amount (nothing preselected).
  const [op, setOp] = useState<Op | null>(null);
  const [amount, setAmount] = useState<Amount | null>(null);
  const [typed, setTyped] = useState('');
  const [tier, setTier] = useState(0);
  const [phase, setPhase] = useState<Phase>('input');
  const [res, setRes] = useState<AnswerResult | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [praise, setPraise] = useState('');
  const shownAt = useRef(0);
  const timer = useRef(0);
  const tipTimer = useRef(0);
  const fb = useFeedbackTime();

  const finish = (): void => {
    fb.flush();
    onFinished();
  };
  const exit = (): void => {
    fb.flush();
    onExit();
  };

  const load = (): void => {
    window.clearTimeout(timer.current);
    window.clearTimeout(tipTimer.current);
    fb.feedback(false);
    const p = nextItem();
    if (!p) {
      finish();
      return;
    }
    const d = p.item.prompt.kind === 'custom' ? readBalanceData(p.item.prompt.data) : null;
    if (!d) {
      finish();
      return;
    }
    fb.shown(p);
    setCur(p);
    // Band C scales always carry balloons; Band B only when the equation needs them.
    const balloons = band.id === 'C' || d.balloons;
    setStack([startState(d.eq, balloons)]);
    setTokens([]);
    setBlocked(null);
    setTip(null);
    setPenalised(0);
    setOp(null);
    setAmount(null);
    setTyped('');
    setTier(0);
    setPhase('input');
    setRes(null);
    setRevealed(false);
    setInvalid(false);
    shownAt.current = performance.now();
  };

  useEffect(() => {
    load();
    return () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(tipTimer.current);
    };
  }, []);

  if (!cur || !session || stack.length === 0) return null;
  const item = cur.item;
  const state = stack[stack.length - 1]!;
  const start = stack[0]!;
  const alone = isolatedValue(state.eq) !== null;
  const hints = phase === 'input' && !alone ? balanceHints(state) : [];
  const hintsOn = flag('hints');

  const attempt = (m: BalanceMove): void => {
    if (phase !== 'input') return;
    unlockAudio();
    const r = applyMove(state, m);
    if (isBlocked(r)) {
      setTokens((ts) => [...ts, `!${moveToken(m)}`]);
      setBlocked(r.blocked);
      if (r.blocked === 'unbalanced') setPenalised((n) => n + 1);
      sfx('soft');
      const dir = tipFor(m);
      if (dir) {
        setTip(dir);
        window.clearTimeout(tipTimer.current);
        tipTimer.current = window.setTimeout(() => setTip(null), 650);
      }
      return;
    }
    sfx('land');
    setTokens((ts) => [...ts, moveToken(m)]);
    setStack((s) => [...s, r]);
    setBlocked(null);
    // The next move is chosen afresh.
    setOp(null);
    setAmount(null);
  };

  const undo = (): void => {
    if (phase !== 'input' || stack.length < 2) return;
    setTokens((ts) => [...ts, 'u']);
    setStack((s) => s.slice(0, -1));
    setBlocked(null);
    setTyped('');
    setOp(null);
    setAmount(null);
  };

  /** The engine's credit tier: one per refused unbalancing move and per hint tier, so y = balanceY(refusals + tiers). */
  const creditTier = (): number => Math.min(4, penalised + tier);

  const submit = (value: string | null): void => {
    if (phase !== 'input') return;
    const conv = getLocale(locale).numbers;
    let v: Rational | null = null;
    if (value !== null) {
      const parsed = parseNumberInput(value, conv);
      if (!parsed.ok) {
        setInvalid(true);
        sfx('soft');
        return;
      }
      v = parsed.candidates[0]!;
    }
    const repr = [...tokens, `=${v ? key(v) : '?'}`].join(';');
    const latency = performance.now() - shownAt.current;
    const r = submitAnswer(
      cur,
      { kind: 'built', value: v, repr, data: { bal: state.balloons ? 1 : 0 } },
      { latencyMs: latency, hint: tier > 0, hintTier: creditTier(), ladderTier: tier, revealed: value === null, input: 'typed', hops: 0 },
    );
    if (r.grade.invalid) {
      setInvalid(true);
      sfx('soft');
      return;
    }
    setInvalid(false);
    setRes(r);
    if (r.grade.correct) {
      setPhase('correct');
      sfx('yes');
      setPraise(t(`play.praise${1 + Math.floor(Math.random() * 4)}` as 'play.praise1'));
      timer.current = window.setTimeout(load, 1100);
      return;
    }
    sfx('soft');
    // Show the balanced scale with x alone: the right answer, reached by the shortest path from here.
    const path = solutionPath(state.eq, state.balloons);
    const solved = path ? replayPath(state, path) : null;
    if (solved) setStack((s) => [...s, solved]);
    setRevealed(value === null);
    setPhase('explain');
    fb.feedback(true);
  };

  const moveLine = (m: BalanceMove): string => {
    const d = describeMove(m);
    return t.dyn(d.key, d.params);
  };
  const hintLines = (): string[] => {
    const h = hints.filter((x) => x.tier <= tier).at(-1);
    if (!h) return [];
    if (h.tier === 1) return [t.dyn(BALANCE_HINT_KEYS[h.kind])];
    if (h.tier === 2) return [moveLine(h.move)];
    return [...h.moves.map(moveLine), ...(h.nextKind ? [t.dyn(BALANCE_HINT_THEN_KEYS[h.nextKind])] : [])];
  };

  const planned = session.engine.planned;
  const firstPresented = session.engine.stats.firstPresented;
  // The offered amounts follow the scale (before an operation is chosen: those for + and −, which are the same).
  // A choice that is no longer on offer is dropped, never replaced: Apply waits for both choices.
  const amounts = suggestions(state.eq, op ?? 'sub', state.balloons);
  const same = (a: Amount): boolean => !!amount && a.n === amount.n && (op === 'div' || a.term === amount.term);
  const chosen = amounts.find(same) ?? null;
  const current = op && chosen ? toMove(op, chosen) : null;
  const opGlyph = (o: Op): string => getLocale(locale).ops[o === 'add' ? '+' : o === 'sub' ? '-' : '/'];
  const sayLines = item.solution.filter((s): s is Extract<SolutionStep, { k: 'say' }> => s.k === 'say');
  const shownLines = band.feedback === 'worked' ? sayLines : sayLines.slice(0, 4);
  const applied = tokens.filter((tk) => !tk.startsWith('!'));
  const answer = numberText(toNumber(item.answer.value), locale);

  return (
    <div class={`play balance-play phase-${phase}${alone ? ' alone' : ''}`}>
      <header class="play-head">
        <button type="button" class="icon-btn" aria-label={t('play.exit')} onClick={exit}>
          <Icon name="close" />
        </button>
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={planned} aria-valuenow={firstPresented} aria-label={t('play.progress', { n: firstPresented, total: planned })}>
          <div class="progress-fill" style={{ width: `${Math.min(100, (firstPresented / planned) * 100)}%` }} />
        </div>
        <LangToggle />
      </header>

      <section class="prompt balance-prompt" aria-live="polite">
        {cur.attempt > 1 && <span class="badge">{t('play.again')}</span>}
        <p class="prompt-text">{alone && phase === 'input' ? t('balance.isolated') : t('balance.prompt')}</p>
        <div class="expr balance-eq" dir="ltr">
          {alone && phase === 'input' ? hiddenValueText(state.eq, locale) : equationText(state.eq, locale)}
        </div>
        {stack.length > 1 && phase === 'input' && !alone && (
          <p class="muted balance-start" dir="ltr">
            {equationText(start.eq, locale)}
          </p>
        )}
        {applied.length > 0 && phase === 'input' && (
          <div class="balance-moves" role="list" aria-label={t('balance.moves')}>
            {moveHistory(tokens).map((m) => (
              <span class="chip small" role="listitem" dir="ltr">
                {moveText(m, locale)}
              </span>
            ))}
          </div>
        )}
      </section>

      <Scale
        eq={state.eq}
        tip={tip}
        isolated={alone}
        label={t('balance.scaleLabel', { left: panText(state.eq.l, locale), right: panText(state.eq.r, locale) })}
        {...(phase === 'input' && !alone ? { onTap: attempt } : {})}
      />

      <section class="feedback" aria-live="assertive">
        {phase === 'input' && blocked && <p class="balance-blocked">{t.dyn(BALANCE_BLOCKED_KEYS[blocked])}</p>}
        {phase === 'input' && tier > 0 && hintLines().map((l) => <p class="hint-text">{l}</p>)}
        {invalid && <p class="invalid">{t('play.invalid')}</p>}
        {phase === 'correct' && <p class="praise">{praise}</p>}
        {phase === 'explain' && res && (
          <div class="explain">
            <h2>{t('play.lookTogether')}</h2>
            <p>{revealed ? t('balance.shown') : t('balance.youTyped', { given: typedText(typed, locale), answer })}</p>
            {shownLines.map((s) => (
              <p class="step" dir="auto">
                {solutionText(s, locale, profile.band)}
              </p>
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
        ) : alone ? (
          <>
            <div class="typed" aria-live="polite">
              <span class="balance-typed">
                <span class="balance-xeq">{t('balance.xEquals')}</span> {typed || <span class="placeholder">{t('play.typeNumber')}</span>}
              </span>
            </div>
            <Numpad
              value={typed}
              resetKey={`${item.key}#${cur.attempt}#${stack.length}`}
              onChange={(v) => {
                setTyped(v);
                setInvalid(false);
              }}
              onSubmit={(v) => submit(v)}
              decimal={getLocale(locale).numbers.decimal}
              allowDecimal={false}
              allowNegative={state.balloons}
              submitLabel={t('balance.check')}
              labels={{ backspace: t('play.backspace'), negative: t('play.negative') }}
              disabled={phase !== 'input'}
            />
          </>
        ) : (
          <div class="balance-composer">
            <div class="balance-ops" role="radiogroup">
              {(['add', 'sub', 'div'] as const).map((o) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={op === o}
                  class={`balance-op${op === o ? ' on' : ''}`}
                  data-op={o}
                  aria-label={t(`balance.op.${o}`)}
                  onClick={() => setOp(o)}
                >
                  {opGlyph(o)}
                </button>
              ))}
            </div>
            <div class="chips balance-amounts">
              {amounts.map((a) => (
                <button
                  type="button"
                  class={`chip num${a === chosen ? ' on' : ''}`}
                  data-n={a.n}
                  data-term={a.term}
                  aria-pressed={a === chosen}
                  onClick={() => setAmount(a)}
                >
                  {op === 'div' && a.n < 0 ? numberText(a.n, locale) : amountText(a.n, a.term, locale)}
                </button>
              ))}
            </div>
            <button type="button" class="btn primary big balance-apply" data-apply disabled={!current} onClick={() => current && attempt(current)}>
              {current ? <span dir="ltr">{t('balance.apply', { move: moveText(current, locale) })}</span> : t('balance.choose')}
            </button>
            <div class="row wrap balance-aux">
              <button type="button" class="btn small ghost" disabled={stack.length < 2} onClick={undo}>
                <Icon name="undo" size={18} /> {t('balance.undo')}
              </button>
              {hintsOn && hints.length > 0 && tier < hints.length && (
                <button type="button" class="btn small ghost" onClick={() => setTier((n) => Math.min(hints.length, n + 1))}>
                  <Icon name="hint" size={18} /> {t('play.hint')}
                </button>
              )}
              {(tier > 0 || penalised > 0 || stack.length > 1) && (
                <button type="button" class="btn small ghost" data-reveal onClick={() => submit(null)}>
                  <Icon name="question" size={18} /> {t('balance.showMe')}
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/** Applied moves after undos, in order (for the move chips). */
function moveHistory(tokens: string[]): BalanceMove[] {
  const out: BalanceMove[] = [];
  for (const tk of tokens) {
    if (tk.startsWith('!')) continue;
    if (tk === 'u') {
      out.pop();
      continue;
    }
    const m = parseMoveToken(tk);
    if (m) out.push(m);
  }
  return out;
}

/** "x = ?" (or "? = x"): x stands alone, and its value is for the child to read off the scale. */
function hiddenValueText(eq: Equation, locale: string): string {
  const eqGlyph = getLocale(locale).ops['='];
  return eq.l.x !== 0 ? `${panText(eq.l, locale)} ${eqGlyph} ?` : `? ${eqGlyph} ${panText(eq.r, locale)}`;
}

function typedText(raw: string, locale: string): string {
  const v = parseNumberInput(raw, getLocale(locale).numbers);
  return v.ok ? numberText(toNumber(v.candidates[0]!), locale) : raw;
}
