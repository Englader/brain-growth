/**
 * The puzzle track (core generators, solvers and views, ~20 KB gzipped) is a
 * separate chunk, fetched the first time the mode opens, so it never weighs on
 * the first load. The service worker precaches every built file, so it still
 * works offline.
 */
import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

let loaded: ComponentType | null = null;
let loading: Promise<ComponentType> | null = null;

export function loadPuzzleMode(): Promise<ComponentType> {
  loading ??= import('./PuzzleMode').then((m) => (loaded = m.PuzzleMode));
  return loading;
}

export function LazyPuzzleMode(): JSX.Element {
  const [C, setC] = useState<ComponentType | null>(() => loaded);
  useEffect(() => {
    if (!C) void loadPuzzleMode().then((c) => setC(() => c));
  }, []);
  return C ? <C /> : <div class="screen puzzle-loading" />;
}
