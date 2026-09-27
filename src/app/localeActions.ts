/**
 * Locale bundles at run time (DESIGN §1.12, "Loading"). Each language's
 * messages and word problems are their own chunk (i18n/locales.ts):
 *  - main.tsx loads the start locale before the first screen, alongside storage;
 *  - the other bundles are fetched when the browser is idle after boot, so a
 *    mid-session switch is instant;
 *  - a switch made before that (a quick tap on a slow first visit) waits for
 *    its bundle while the toggle shows it as busy, and the screen keeps its
 *    current language until then: never raw keys.
 * The service worker precaches every chunk, so all of this works offline.
 */
import type { LocaleId } from '../core/types';
import { allLocales, isLocaleLoaded, loadAllLocales, loadedLocales, loadLocale, onLocaleLoaded } from '../i18n/locales';
import { guessLocale } from '../ui/hooks';
import { repo } from './services';
import { tabChild } from './tab';
import { getState, setState } from './store';

/**
 * The language of the first screen: the child playing in this tab (a reload),
 * else the one chosen on this device for "Who's playing?" and the new-player
 * form, else the browser's. Profiles and meta live in localStorage (A-8), so
 * this is known before storage init ends.
 */
export function startLocale(): LocaleId {
  try {
    const meta = repo.meta();
    const pid = tabChild();
    const active = pid ? repo.loadProfile(pid) : null;
    return active?.locale ?? meta.uiLocale ?? guessLocale();
  } catch {
    return guessLocale();
  }
}

/** Load a bundle for the first screen: `id` (one retry), else any locale that loads. Never rejects. */
export async function loadStartLocale(id: LocaleId): Promise<void> {
  const tries = [id, id, ...allLocales().map((l) => l.id).filter((x) => x !== id)];
  for (const x of tries) {
    try {
      await loadLocale(x);
      return;
    } catch {
      // try the next
    }
  }
}

/** Keep the store's `locales` in step with the loaded bundles (a change re-renders every translator). */
export function trackLocales(): void {
  setState({ locales: loadedLocales() });
  onLocaleLoaded(() => setState({ locales: loadedLocales() }));
}

/** Fetch every other bundle once the browser is idle, so switching language never waits. */
export function prefetchLocales(): void {
  const go = (): void => void loadAllLocales().catch(() => undefined);
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 3000 });
  else window.setTimeout(go, 1500);
}

/**
 * Run `apply` once `locale`'s bundle is in: at once when it already is (the
 * usual case, after the idle prefetch); otherwise the switch is pending
 * (`localePending`, shown on the toggle) until the bundle arrives. A newer
 * request supersedes a pending one. On a failed load the pending state
 * clears and `failed` runs; tapping again retries.
 */
export function whenLocaleReady(locale: LocaleId, apply: () => void, failed: () => void = () => undefined): void {
  if (isLocaleLoaded(locale)) {
    if (getState().localePending !== null) setState({ localePending: null });
    apply();
    return;
  }
  setState({ localePending: locale });
  const settle = (ok: boolean): void => {
    if (getState().localePending !== locale) return;
    setState({ localePending: null });
    if (ok) apply();
    else failed();
  };
  loadLocale(locale).then(
    () => settle(true),
    () => settle(false),
  );
}
