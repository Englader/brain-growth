/**
 * Screens loaded on first use: the one lazy-loading mechanism of the app
 * (DESIGN §3.2, "Size"). Every mode other than Hop registers its screens as
 *
 *   Component: lazyScreen(() => import('./XMode').then((m) => m.XMode)),
 *
 * so Vite splits each (with its CSS) into its own chunk and the start-up
 * bundle only carries the registration: titles, icons and readiness stay
 * eager, so home cards work before any chunk is fetched. The service worker
 * precaches every emitted chunk, so this works offline.
 *
 * `launchMode` calls `preloadMode` before it navigates, so the chunk is
 * usually in before the route renders. Until it is, the screen keeps its
 * background; "Loading…" appears only if it takes longer than a moment,
 * and a failed fetch (offline before the worker cached it) offers to retry.
 * `scripts/size-check.mjs` keeps the entry chunk inside its budget in CI.
 */
import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { navigate } from '../app/router';
import { useT } from '../ui/hooks';
import type { ModeDef } from './types';

/** A screen component that fetches its chunk on first render, or earlier through `preload()`. */
export interface LazyScreen {
  (): JSX.Element | null;
  /** Start fetching (idempotent; a failed fetch may be retried). Resolves to the loaded screen. */
  preload(): Promise<ComponentType>;
}

export interface LazyScreenOptions {
  /** Class of the placeholder while the chunk loads (default `screen lazy-screen`), e.g. to keep a play background. */
  placeholderClass?: string;
}

/** Below this, loading shows nothing (a chunk from the service-worker cache takes a frame or two). */
const QUIET_MS = 400;

export function lazyScreen(load: () => Promise<ComponentType>, opts: LazyScreenOptions = {}): LazyScreen {
  let cached: ComponentType | null = null;
  let pending: Promise<ComponentType> | null = null;
  const preload = (): Promise<ComponentType> => {
    pending ??= load().then(
      (c) => (cached = c),
      (e: unknown) => {
        pending = null;
        throw e;
      },
    );
    return pending;
  };

  const Screen = function LazyScreen(): JSX.Element | null {
    const [C, setC] = useState<ComponentType | null>(() => cached);
    const [phase, setPhase] = useState<'quiet' | 'slow' | 'failed'>('quiet');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
      if (C) return undefined;
      let live = true;
      const timer = window.setTimeout(() => live && setPhase((p) => (p === 'quiet' ? 'slow' : p)), QUIET_MS);
      preload().then(
        (c) => live && setC(() => c),
        () => {
          window.clearTimeout(timer);
          if (live) setPhase('failed');
        },
      );
      return () => {
        live = false;
        window.clearTimeout(timer);
      };
    }, [attempt]);
    if (C) return <C />;
    return (
      <LazyWait
        cls={opts.placeholderClass ?? 'screen lazy-screen'}
        phase={phase}
        retry={() => {
          setPhase('quiet');
          setAttempt((n) => n + 1);
        }}
      />
    );
  } as LazyScreen;
  Screen.preload = preload;
  return Screen;
}

function LazyWait({ cls, phase, retry }: { cls: string; phase: 'quiet' | 'slow' | 'failed'; retry: () => void }): JSX.Element {
  const t = useT();
  return (
    <div class={cls} aria-busy={phase !== 'failed'}>
      {phase === 'slow' && (
        <p class="lazy-msg muted" role="status">
          {t('common.loading')}
        </p>
      )}
      {phase === 'failed' && (
        <div class="lazy-msg card" role="alert">
          <p>{t('common.loadFailed')}</p>
          <div class="row">
            <button type="button" class="btn primary" onClick={retry}>
              {t('common.retry')}
            </button>
            <button type="button" class="btn" onClick={() => navigate('/', true)}>
              {t('common.home')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const isLazy = (c: ComponentType | undefined): c is ComponentType & LazyScreen =>
  typeof (c as Partial<LazyScreen> | undefined)?.preload === 'function';

/** Start fetching a mode's lazy screens (intro and play), e.g. as it is launched. Never rejects. */
export function preloadMode(mode: ModeDef): void {
  for (const c of [mode.intro, mode.Component]) if (isLazy(c)) void c.preload().catch(() => undefined);
}
