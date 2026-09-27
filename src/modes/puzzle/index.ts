/**
 * Puzzle track registration (plan §4 step 8). Standalone mode: /play/puzzle
 * renders the shelf without an engine session. On by default (DESIGN A-26),
 * per-child switch `mode.puzzle`; ready once placement is done, so a new child
 * starts on the number trail (the only mode that places) and meets puzzles
 * from the second visit to the home screen; the Band A home simply shows the
 * tile then. The mode itself is a lazily loaded chunk (./lazy).
 */
import { navigate } from '../../app/router';
import { registerMode } from '../registry';
import { LazyPuzzleMode, loadPuzzleMode } from './lazy';

registerMode({
  id: 'puzzle',
  order: 40,
  titleKey: 'puzzle.title',
  descKey: 'puzzle.desc',
  icon: 'puzzle',
  requires: [],
  bands: ['A', 'B', 'C'],
  flag: 'mode.puzzle',
  engine: false,
  homeA: true,
  ready: (p) => p.placement.done,
  notReadyKey: 'puzzle.notReady',
  launch: () => {
    void loadPuzzleMode();
    navigate('/play/puzzle');
  },
  Component: LazyPuzzleMode,
});
