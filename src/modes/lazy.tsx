/**
 * A mode screen loaded on first use: `Component: lazyScreen(() => import('./X').then((m) => m.X))`.
 * Vite splits the screen (and its CSS) into its own chunk, keeping it out of
 * the start-up bundle; the service worker precaches every emitted chunk, so
 * it still works offline. Until the chunk arrives the screen renders nothing
 * (from the precache that is a frame or two).
 */
import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export function lazyScreen(load: () => Promise<ComponentType>): ComponentType {
  let cached: ComponentType | null = null;
  let pending: Promise<ComponentType> | null = null;
  const get = (): Promise<ComponentType> => (pending ??= load().then((c) => (cached = c)));
  return function LazyScreen(): JSX.Element | null {
    const [C, setC] = useState<ComponentType | null>(() => cached);
    useEffect(() => {
      if (C) return;
      let live = true;
      void get().then((c) => live && setC(() => c));
      return () => {
        live = false;
      };
    }, []);
    return C ? <C /> : null;
  };
}
