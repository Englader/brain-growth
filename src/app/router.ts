/**
 * Hash routing: GitHub Pages has no server-side rewrites, so deep links must
 * live in the fragment. Fragments are also never sent to the server, which
 * is why rival cards travel as #/rival/<payload>.
 */
import { setState, type AppState } from './store';

/** The new route, and the Grown-ups area locked again when the route leaves it (DESIGN A-30). */
const routeTo = (route: string) => (s: AppState): Partial<AppState> => (route !== '/adult' && s.adultLock !== 'locked' ? { route, adultLock: 'locked' } : { route });

export function currentRoute(): string {
  const h = typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : '';
  return h || '/';
}

export function navigate(path: string, replace = false): void {
  const url = `#${path}`;
  if (replace) history.replaceState(null, '', url);
  else if (location.hash !== url) history.pushState(null, '', url);
  setState(routeTo(path));
}

export function startRouter(): void {
  window.addEventListener('popstate', () => setState(routeTo(currentRoute())));
  window.addEventListener('hashchange', () => setState(routeTo(currentRoute())));
  setState(routeTo(currentRoute()));
}
