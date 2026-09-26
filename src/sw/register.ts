/**
 * Service-worker registration with SAFE updates: a new version installs in
 * the background and is only activated while the child is on a menu screen
 * (never mid-session), then the page reloads once.
 */
import { getState, setState, subscribe } from '../app/store';

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  let waiting: ServiceWorker | null = null;
  let reloading = false;

  const safeToUpdate = (): boolean => {
    const s = getState();
    return !s.session && !s.route.startsWith('/play/');
  };
  const tryActivate = (): void => {
    if (waiting && safeToUpdate()) waiting.postMessage('SKIP_WAITING');
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

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
