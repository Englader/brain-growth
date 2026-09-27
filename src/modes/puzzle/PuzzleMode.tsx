/**
 * The puzzle track (DESIGN §1.4, plan §4 step 8): a shelf of puzzle types the
 * child picks freely, then one puzzle at a time, each at the level the type's
 * own rating suggests. Standalone (engine: false): no engine session, no item
 * records, no timer, no streak or quest coupling. A session record opens with
 * the first puzzle and closes when the child leaves.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { toast } from '../../app/actions';
import { beginPuzzle, completePuzzle, endPuzzleSession, startPuzzleSession, type PuzzleSession } from '../../app/puzzleActions';
import { navigate } from '../../app/router';
import { getState, useStore } from '../../app/store';
import { getPuzzleType, type PuzzleOutcome, type StartedPuzzle } from '../../puzzles';
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

  if (!profile) return null;

  const start = (type: string): void => {
    const p = getState().profile!;
    session.current ??= startPuzzleSession(p);
    live.current = { phase: 'input', hints: 0, wrong: 0 };
    setCurrent((c) => ({ started: beginPuzzle(p, type, harder), n: (c?.n ?? 0) + 1 }));
  };
  const done = (outcome: PuzzleOutcome): void => {
    const p = getState().profile;
    if (!p || !current || !session.current) return;
    const r = completePuzzle(p, session.current, current.started, outcome);
    session.current = r.session;
    for (const id of r.unlocked) toast(t.dyn(`ach.${id}.name`));
  };
  const exit = (): void => {
    close();
    navigate('/', true);
  };

  if (!current) {
    return <Shelf profile={profile} harder={harder} setHarder={setHarder} onPick={start} onExit={exit} />;
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
