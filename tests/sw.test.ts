/**
 * Service-worker update rules (src/sw/register.ts): the first install never
 * reloads the page (it used to, ~1.5 s after a first visit, wiping a
 * half-filled create form); a real update reloads once, and only away from play.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ActiveSession } from '../src/app/store';
import { reloadOnUpdate, safeToUpdate } from '../src/sw/register';

class FakeContainer extends EventTarget {
  constructor(public controller: object | null) {
    super();
  }
  /** What the browser does when a worker claims the page. */
  claim(): void {
    this.controller = {};
    this.dispatchEvent(new Event('controllerchange'));
  }
}

const watch = (controller: object | null): { c: FakeContainer; reload: ReturnType<typeof vi.fn> } => {
  const c = new FakeContainer(controller);
  const reload = vi.fn();
  reloadOnUpdate(c as unknown as ServiceWorkerContainer, reload);
  return { c, reload };
};

describe('service worker: reload only on a real update', () => {
  it('the first install claiming an uncontrolled page does not reload it', () => {
    const { c, reload } = watch(null);
    c.claim();
    expect(reload).not.toHaveBeenCalled();
  });

  it('a later update on that same page reloads it, once', () => {
    const { c, reload } = watch(null);
    c.claim(); // first install
    c.claim(); // a new version takes over
    c.claim();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a page that was already controlled reloads when the new version takes over', () => {
    const { c, reload } = watch({});
    c.claim();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('service worker: an update never applies during play', () => {
  it('is safe on menu screens without a session only', () => {
    const session = {} as ActiveSession;
    expect(safeToUpdate({ session: null, route: '/' })).toBe(true);
    expect(safeToUpdate({ session: null, route: '/results' })).toBe(true);
    expect(safeToUpdate({ session, route: '/' })).toBe(false);
    expect(safeToUpdate({ session: null, route: '/play/dice' })).toBe(false);
    expect(safeToUpdate({ session, route: '/play/hop' })).toBe(false);
  });
});
