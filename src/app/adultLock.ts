/**
 * Is the Grown-ups area open (DESIGN A-30)? Only in memory: the right parent
 * PIN opens it (src/app/pinActions.ts), and it locks again when the route
 * leaves /adult (router.ts), after 5 minutes without a tap or a key, and on
 * every reload. Every way in, the picker's button, Settings or a typed
 * #/adult, meets the PIN gate first (App.tsx).
 */
import { now } from './services';
import { getState, setState } from './store';

export const ADULT_IDLE_MS = 5 * 60_000;

let lastActivity = 0;

export function unlockAdult(): void {
  lastActivity = now();
  setState({ adultLock: 'open' });
}

export function lockAdult(reason: 'locked' | 'idle' = 'locked'): void {
  if (getState().adultLock === 'open') setState({ adultLock: reason });
}

/** A tap, key or scroll inside the open area: the idle clock starts again. */
export function touchAdult(): void {
  lastActivity = now();
}

/** Lock the area if it has been idle for ADULT_IDLE_MS. True when it locked. */
export function checkAdultIdle(): boolean {
  if (getState().adultLock !== 'open' || now() - lastActivity < ADULT_IDLE_MS) return false;
  lockAdult('idle');
  return true;
}

/**
 * While the area is open: count activity and check the idle time every 15 s and
 * whenever the page becomes visible again (timers sleep in a hidden tab). Returns the cleanup.
 */
export function watchAdultIdle(): () => void {
  const events = ['pointerdown', 'keydown', 'wheel', 'touchmove', 'scroll'] as const;
  for (const e of events) window.addEventListener(e, touchAdult, { passive: true, capture: true });
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') checkAdultIdle();
  };
  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(checkAdultIdle, 15_000);
  return () => {
    for (const e of events) window.removeEventListener(e, touchAdult, { capture: true });
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
  };
}
