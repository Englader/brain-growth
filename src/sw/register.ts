/**
 * Service-worker registration with SAFE updates: a new version installs in
 * the background and is only activated while the child is on a menu screen
 * (never mid-session), then the page reloads once.
 *
 * The very first install is not an update: the new worker claims the page
 * (clients.claim) and fires `controllerchange` about 1.5 s after the first
 * visit. Reloading then would wipe whatever the grown-up had started typing
 * on the create screen, so the page reloads only when a controller is
 * *replaced* (reloadOnUpdate).
 */
import { getState, setState, subscribe, type AppState } from '../app/store';

/** An update may apply only away from play: no session, not on a /play/ route. */
export function safeToUpdate(s: Pick<AppState, 'session' | 'route'>): boolean {
  return !s.session && !s.route.startsWith('/play/');
}

/**
 * Reload when a new worker takes over from a previous one. The first
 * `controllerchange` of a page that had no controller is the first install
 * claiming it: the page already runs the current version, so nothing reloads.
 */
export function reloadOnUpdate(container: Pick<ServiceWorkerContainer, 'controller' | 'addEventListener'>, reload: () => void): void {
  let controlled = !!container.controller;
  let reloading = false;
  container.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    reload();
  });
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  let waiting: ServiceWorker | null = null;

  const tryActivate = (): void => {
    if (waiting && safeToUpdate(getState())) waiting.postMessage('SKIP_WAITING');
  };

  reloadOnUpdate(navigator.serviceWorker, () => window.location.reload());

  void navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (!reg) return;
    const track = (sw: ServiceWorker | null): void => {
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          waiting = sw;
          setState({ swUpdateReady: true });
          tryActivate();
        }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) {
      waiting = reg.waiting;
      tryActivate();
    }
    reg.addEventListener('updatefound', () => track(reg.installing));
    // Check for updates when the app regains focus (installed PWAs rarely reload).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
    });
  }).catch(() => undefined);

  subscribe(() => tryActivate());
}
