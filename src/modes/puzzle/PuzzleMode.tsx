/**
 * The puzzle track (DESIGN §1.4, plan §4 step 8): a shelf of puzzle types the
 * child picks freely, then one puzzle at a time, each at the level the type's
 * own rating suggests. Standalone (engine: false): no engine session, no item
 * records, no timer, no streak or quest coupling. A session record opens with
 * the first puzzle and closes when the child leaves.
 *
 * The shelf follows the school year on the home's bar (DESIGN A-29): the
 * year's band picks the types (kept to those the child's band can play) and
 * the level moves for a year above or below the child's own. Opened for
 * today's puzzle challenge, it goes straight to that type; solving one ticks
 * the challenge.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { toast } from '../../app/actions';
import { beginPuzzle, completePuzzle, endPuzzleSession, startPuzzleSession, type PuzzleSession } from '../../app/puzzleActions';
import { selectedYear } from '../../app/yearActions';
import type { SessionOptions } from '../../core/log/types';
import { puzzleTypesForYear } from '../../core/years';
import { navigate } from '../../app/router';
import { getState, useStore } from '../../app/store';
import { getPuzzleType, puzzleTypesFor, type PuzzleOutcome, type StartedPuzzle } from '../../puzzles';
import { useT } from '../../ui/hooks';
import './puzzle.css';
import { PuzzlePlay, type PuzzlePhase } from './PuzzlePlay';
import { Shelf } from './Shelf';
import { publishPuzzleState } from './testHook';

export function PuzzleMode(): JSX.Element | null {
  const t = useT();
  const profile = useStore((s) => s.profile);
  const [harder, setHarder] = useState(false);
  const [current, setCurrent] = useState<{ started: StartedPuzzle<unknown>; n: number } | null>(null);
  // The year (and challenge) this shelf was opened with; the bar's year after a reload.
  const [opts] = useState<SessionOptions>(() => {
    const lo = getState().launchOpts;
    const year = lo?.year ?? (profile ? selectedYear(profile) : undefined);
    return { ...(year !== undefined ? { year } : {}), ...(lo?.challenge?.startsWith('puzzle.') ? { challenge: lo.challenge } : {}) };
  });
  const session = useRef<PuzzleSession | null>(null);
  const live = useRef<{ phase: PuzzlePhase; hints: number; wrong: number }>({ phase: 'input', hints: 0, wrong: 0 });

  const close = (): void => {
    const s = session.current;
    const p = getState().profile;
    session.current = null;
    if (!s || !p || p.id !== s.pid) return;
    const r = endPuzzleSession(p, s);
    for (const id of r.unlocked) toast(t.dyn(`ach.${id}.name`));
  };
  // Leaving the route any other way (system back) still closes the session record.
  useEffect(() => close, []);

  // e2e: the reader follows the current puzzle synchronously (a ref set during render).
  const shown = useRef(current);
  shown.current = current;
  useEffect(() => {
    publishPuzzleState(() => {
      const c = shown.current;
      if (!c) return null;
      return { ...c.started, solutions: getPuzzleType(c.started.type).solve(c.started.puzzle), ...live.current };
    });
    return () => publishPuzzleState(null);
  }, []);

  const types = profile ? (opts.year === undefined ? puzzleTypesFor(profile.band).map((d) => d.id) : puzzleTypesForYear(opts.year, profile.band, puzzleTypesFor)) : [];

  const start = (type: string): void => {
    const p = getState().profile!;
    session.current ??= startPuzzleSession(p, opts);
    live.current = { phase: 'input', hints: 0, wrong: 0 };
    setCurrent((c) => ({ started: beginPuzzle(p, type, harder, opts.year), n: (c?.n ?? 0) + 1 }));
  };

  // Today's puzzle challenge opens its puzzle at once (the shelf is one tap away).
  const challengeType = opts.challenge?.slice('puzzle.'.length);
  const autostart = !!challengeType && types.includes(challengeType);
  useEffect(() => {
    if (autostart) start(challengeType!);
  }, []);

  if (!profile) return null;

  const done = (outcome: PuzzleOutcome): void => {
    const p = getState().profile;
    if (!p || !current || !session.current) return;
    const r = completePuzzle(p, session.current, current.started, outcome);
    session.current = r.session;
    for (const id of r.unlocked) toast(t.dyn(`ach.${id}.name`));
    if (r.gifts.length) toast(t('year.today.gift'));
  };
  const exit = (): void => {
    close();
    navigate('/', true);
  };

  // Until the challenge's puzzle is in (the next frame), show the play background rather than flash the shelf.
  if (!current && autostart && !session.current) return <div class="play puzzle-play lazy-screen" />;
  if (!current) {
    return <Shelf profile={profile} types={types} year={opts.year} harder={harder} setHarder={setHarder} onPick={start} onExit={exit} />;
  }
  return (
    <PuzzlePlay
      key={current.n}
      started={current.started}
      profile={profile}
      onDone={done}
      onNext={() => start(current.started.type)}
      onShelf={() => setCurrent(null)}
      onState={(s) => (live.current = s)}
    />
  );
}
