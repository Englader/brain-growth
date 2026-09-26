/**
 * Hash routing: GitHub Pages has no server-side rewrites, so deep links must
 * live in the fragment. Fragments are also never sent to the server, which
 * is why rival cards travel as #/rival/<payload>.
 */
import { setState } from './store';

export function currentRoute(): string {
  const h = typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : '';
  return h || '/';
}

export function navigate(path: string, replace = false): void {
  const url = `#${path}`;
  if (replace) history.replaceState(null, '', url);
  else if (location.hash !== url) history.pushState(null, '', url);
  setState({ route: path });
}

export function startRouter(): void {
  window.addEventListener('popstate', () => setState({ route: currentRoute() }));
  window.addEventListener('hashchange', () => setState({ route: currentRoute() }));
  setState({ route: currentRoute() });
}
