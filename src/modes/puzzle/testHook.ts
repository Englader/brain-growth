/**
 * e2e only: while the puzzle mode is on screen, `window.__hopa.puzzle()`
 * returns the current puzzle, its provenance and the core solver's solutions,
 * so a flow can solve it through the real UI. `__hopa` exists only with `?e2e`
 * (src/app/testHooks.ts); without it this does nothing.
 */
type Reader = (() => unknown) | null;

export function publishPuzzleState(read: Reader): void {
  if (typeof window === 'undefined') return;
  const hooks = (window as unknown as { __hopa?: Record<string, unknown> }).__hopa;
  if (!hooks) return;
  if (read) hooks.puzzle = read;
  else delete hooks.puzzle;
}
