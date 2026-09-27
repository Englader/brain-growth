/**
 * One puzzle, any type. The frame owns what is common: unlimited checks with a
 * gentle "not yet" that lights up the broken constraint, the hint ladder, the
 * reveal, and the outcome that feeds the rating
 * (y = solved ? max(0, 1 − 0.25·hints − 0.1·min(3, wrong checks)) : 0). There is
 * no clock anywhere. Band A has no text and no failure state: a wrong tap
 * brings the next hint (spoken and lit up), and once the hints are used up the
 * right answer glows to be tapped together.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { flag, speaker } from '../../app/services';
import { play as sfx, unlockAudio } from '../../audio/sfx';
import { getBand } from '../../bands/registry';
import type { Profile } from '../../core/profile';
import type { BandId } from '../../core/types';
import type { MessageParams } from '../../i18n/format';
import { getLocale } from '../../i18n/locales';
import { getPuzzleType, violationKey, type AnyPuzzleType, type PuzzleHint, type PuzzleOutcome, type StartedPuzzle } from '../../puzzles';
import { LangToggle } from '../../ui/components/common';
import { Icon } from '../../ui/components/Icon';
import { useT } from '../../ui/hooks';
import { Item, Sym, Weight } from './art';
import { VIEWS } from './views';
import type { ViewDef } from './views/types';

export type PuzzlePhase = 'input' | 'solved' | 'revealed';

export interface PuzzlePlayProps {
  started: StartedPuzzle<unknown>;
  profile: Profile;
  onDone: (outcome: PuzzleOutcome) => void;
  onNext: () => void;
  onShelf: () => void;
  /** Test hook feed (e2e only): the frame reports its live state. */
  onState?: (s: { phase: PuzzlePhase; hints: number; wrong: number }) => void;
}

/** Band A voice line for a hint rung (text-free play). */
const HINT_VOICE = new Set(['unit', 'same', 'groups', 'grows', 'start', 'remove', 'share', 'count', 'known']);

function hintParams(h: PuzzleHint, locale: string): MessageParams {
  const ops = getLocale(locale).ops;
  const out: MessageParams = {};
  for (const [k, v] of Object.entries(h.params)) if (typeof v === 'number') out[k] = v;
  if (h.key.endsWith('.roundBoth')) out.op = ops['*'];
  if (h.key.endsWith('.friendlyDivide')) out.op = ops['/'];
  if (h.key.endsWith('.ratio')) out.form = h.params.den === 1 ? 'times' : 'part';
  return out;
}

/** Ids named by a hint (a shape, a symbol, a pair of logic items) are drawn next to its text. */
function HintIcons({ h }: { h: PuzzleHint }): JSX.Element | null {
  const p = h.params;
  if (typeof p.shape === 'string') return <Weight id={p.shape} size={26} />;
  if (typeof p.sym === 'string') return <Sym id={p.sym} size={26} />;
  if (typeof p.item === 'string' && typeof p.anchor === 'string') {
    return (
      <span class="pz-hint-pair">
        <Item id={p.anchor} size={26} />
        <Item id={p.item} size={26} />
      </span>
    );
  }
  return null;
}

export function PuzzlePlay(props: PuzzlePlayProps): JSX.Element {
  const { started, profile, onDone } = props;
  const t = useT();
  const locale = t.locale;
  const band: BandId = started.band;
  const bandA = band === 'A';
  const def = getPuzzleType(started.type) as AnyPuzzleType;
  const view = VIEWS[started.type] as ViewDef<unknown, unknown, unknown>;
  const p = started.puzzle;
  const voiceOn = profile.settings.voice && getBand(profile.band).audio !== 'off';
  const say = (key: string, params: MessageParams = {}): void => {
    if (voiceOn) speaker.say(key, params, locale);
  };

  const [state, setState] = useState<unknown>(() => view.init(p, band));
  const sRef = useRef(state);
  const update = (f: (s: unknown) => unknown): void => {
    sRef.current = f(sRef.current);
    setState(sRef.current);
  };
  const [phase, setPhaseState] = useState<PuzzlePhase>('input');
  const phaseRef = useRef<PuzzlePhase>('input');
  const setPhase = (ph: PuzzlePhase): void => {
    phaseRef.current = ph;
    setPhaseState(ph);
  };
  const [marks, setMarks] = useState<ReadonlySet<string>>(new Set());
  const [notYet, setNotYet] = useState<Array<{ key: string; n: number }>>([]);
  const [hint, setHint] = useState<PuzzleHint | null>(null);
  const [glow, setGlow] = useState<unknown>(null);
  const counts = useRef({ hints: 0, wrong: 0, fails: [] as string[], glowed: false });
  const [, setTick] = useState(0);
  const solution = useMemo(() => def.solve(p)[0] ?? null, [p]);

  useEffect(() => {
    if (bandA) say(`voice.puzzle.${started.type}`);
    return () => speaker.stop();
  }, []);
  useEffect(() => {
    props.onState?.({ phase, hints: counts.current.hints, wrong: counts.current.wrong });
  });

  const finish = (solved: boolean): void => {
    const c = counts.current;
    onDone({ solved, hints: c.hints, wrongChecks: c.wrong, fails: [...c.fails] });
  };

  const nextHint = (): PuzzleHint | null => {
    const h = def.hint(p, counts.current.hints + 1);
    if (!h) return null;
    counts.current.hints++;
    setHint(h);
    setMarks(new Set(h.focus));
    return h;
  };

  const check = (override?: unknown): void => {
    if (phaseRef.current !== 'input') return;
    unlockAudio();
    const s = override ?? sRef.current;
    if (!override && !view.canCheck(p, s)) return;
    const r = def.check(p, view.answer(p, s));
    if (r.ok) {
      const together = counts.current.glowed;
      setPhase(together ? 'revealed' : 'solved');
      setMarks(new Set());
      setNotYet([]);
      setGlow(null);
      sfx('yes');
      if (bandA) say(together ? 'voice.puzzle.together' : 'voice.puzzle.solved');
      // The errorless tap after every hint is a reveal for the rating (y = 0), shown as a shared success.
      finish(!together);
      return;
    }
    const violated = r.violated ?? ['answer'];
    counts.current.wrong++;
    counts.current.fails.push(violated.join('+'));
    setTick((n) => n + 1);
    sfx('soft');
    const byKey = new Map<string, number>();
    for (const v of violated) byKey.set(violationKey(v), (byKey.get(violationKey(v)) ?? 0) + 1);
    setNotYet([...byKey].map(([key, n]) => ({ key, n })));
    if (bandA) {
      // No failure state in Band A: the next hint comes by itself; when they are used up, the answer glows.
      const h = nextHint();
      const leaf = h?.key.split('.').pop() ?? '';
      setMarks(new Set([...(h?.focus ?? []), ...violated]));
      if (h && HINT_VOICE.has(leaf)) say(`voice.puzzle.hint.${leaf}`, typeof h.params.weight === 'number' ? { weight: h.params.weight } : {});
      else if (!h && solution !== null) {
        counts.current.glowed = true;
        setGlow(solution);
        say('voice.tapGlow');
      } else say('voice.puzzle.notYet');
      return;
    }
    setHint(null);
    setMarks(new Set(violated));
  };

  const onHint = (): void => {
    if (phaseRef.current !== 'input') return;
    nextHint();
    setNotYet([]);
  };

  const reveal = (): void => {
    if (phaseRef.current !== 'input' || solution === null) return;
    update(() => view.fromAnswer(p, solution, band));
    setPhase('revealed');
    setMarks(new Set());
    setNotYet([]);
    setHint(null);
    finish(false);
  };

  const locked = phase !== 'input';
  const hintsOn = !bandA && flag('hints');
  const hasHint = hintsOn && phase === 'input' && def.hint(p, counts.current.hints + 1) !== null;
  const canReveal = !bandA && phase === 'input' && (counts.current.wrong >= 2 || def.hint(p, counts.current.hints + 1) === null);
  const Board = view.Board;
  const tapToCheck = view.tapToCheck?.(p, band) ?? false;
  const title = t.dyn(`puzzle.type.${started.type}`);

  return (
    <div class={`play puzzle-play pz-${started.type} phase-${phase}`}>
      <header class="play-head">
        <button type="button" class="icon-btn" aria-label={t('puzzle.toShelf')} onClick={props.onShelf}>
          <Icon name="close" />
        </button>
        {bandA ? <span class="grow" /> : <h1 class="topbar-title">{title}</h1>}
        {bandA && voiceOn && (
          <button type="button" class="icon-btn" aria-label={t('common.speaker')} onClick={() => say(`voice.puzzle.${started.type}`)}>
            <Icon name="speaker" />
          </button>
        )}
        <LangToggle />
      </header>
      {!bandA && <p class="prompt-text pz-ask">{t.dyn(`puzzle.ask.${started.type}`)}</p>}

      <section class="puzzle-board">
        <Board puzzle={p} state={state} update={update} marks={marks} locked={locked} band={band} locale={locale} t={t} check={check} glow={glow} />
      </section>

      <section class="feedback" aria-live="polite">
        {phase === 'solved' && (bandA ? <Icon name="star" size={48} solid class="pz-star" /> : <p class="praise">{t('puzzle.solved')}</p>)}
        {phase === 'revealed' && (bandA ? <Icon name="heart" size={44} solid class="pz-star" /> : <p class="note">{t('puzzle.revealed')}</p>)}
        {!bandA && phase === 'input' && notYet.length > 0 && (
          <div class="pz-notyet">
            {notYet.map((m) => (
              <p>{t.dyn(m.key, { n: m.n })}</p>
            ))}
          </div>
        )}
        {!bandA && phase === 'input' && hint && (
          <p class="hint-text pz-hint">
            <HintIcons h={hint} />
            <span>{t.dyn(hint.key, hintParams(hint, locale))}</span>
          </p>
        )}
      </section>

      <section class="controls pz-controls">
        {phase === 'input' ? (
          <>
            {(hasHint || canReveal) && (
              <div class="row wrap pz-help">
                {hasHint && (
                  <button type="button" class="btn ghost small" onClick={onHint}>
                    <Icon name="hint" size={18} /> {t('puzzle.help')}
                  </button>
                )}
                {canReveal && (
                  <button type="button" class="btn ghost small pz-reveal" onClick={reveal}>
                    <Icon name="eye" size={18} /> {t('puzzle.reveal')}
                  </button>
                )}
              </div>
            )}
            {!tapToCheck && (
              <button type="button" class="btn go big pz-check" disabled={!view.canCheck(p, state)} onClick={() => check()}>
                {bandA ? <Icon name="check" size={36} /> : t('puzzle.check')}
              </button>
            )}
          </>
        ) : bandA ? (
          <div class="row center-row">
            <button type="button" class="btn big pz-more" aria-label={t('puzzle.more')} onClick={props.onShelf}>
              <Icon name="grid" size={34} />
            </button>
            <button type="button" class="btn go big pz-next" aria-label={t('puzzle.next')} onClick={props.onNext}>
              <Icon name="play" size={40} solid />
            </button>
          </div>
        ) : (
          <div class="row center-row">
            <button type="button" class="btn big pz-more" onClick={props.onShelf}>
              {t('puzzle.more')}
            </button>
            <button type="button" class="btn primary big pz-next" onClick={props.onNext}>
              {t('puzzle.next')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
