/**
 * Puzzle track registration (plan §4 step 8). Standalone mode: /play/puzzle
 * renders the shelf without an engine session. On by default (DESIGN A-26),
 * per-child switch `mode.puzzle`; ready once placement is done, so a new child
 * starts on the number trail (the only mode that places) and meets puzzles
 * from the second visit to the home screen; the Band A home simply shows the
 * tile then. The mode itself (core generators, solvers and views, ~21 KB
 * gzipped) is a chunk loaded on first use (../lazy.tsx); launchMode starts
 * fetching it before navigating, and the service worker precaches it.
 */
import { navigate } from '../../app/router';
import { lazyScreen } from '../lazy';
import { registerMode } from '../registry';

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
  // Straight to the shelf (no engine session); launchMode has already started fetching the chunk.
  launch: () => navigate('/play/puzzle'),
  Component: lazyScreen(() => import('./PuzzleMode').then((m) => m.PuzzleMode)),
});
