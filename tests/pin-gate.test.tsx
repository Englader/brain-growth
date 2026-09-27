// @vitest-environment jsdom
/**
 * The parent-PIN gate in the app (DESIGN A-30): every way into #/adult (a
 * typed URL, the picker's button, Settings) meets the gate first; the right
 * PIN opens the area; leaving it or 5 idle minutes lock it again; with no PIN
 * the gate starts with the grown-ups' question.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import '../src/modes';
import { AdultScreen } from '../src/adult/screen';
import { boot } from '../src/app/actions';
import { ADULT_IDLE_MS, checkAdultIdle, touchAdult, unlockAdult } from '../src/app/adultLock';
import { App } from '../src/app/App';
import { saveProfile } from '../src/app/persist';
import { removeParentPin, setParentPin } from '../src/app/pinActions';
import { navigate, startRouter } from '../src/app/router';
import { repo, testOverrides } from '../src/app/services';
import { getState, setState } from '../src/app/store';
import { rememberTabChild } from '../src/app/tab';
import { createProfile } from '../src/core/profile';
import { PinGateScreen } from '../src/ui/pin/screen';

/** A fresh page on `hash`: empty store, boot() as main.tsx runs it, then the App. */
function open(hash: string): HTMLElement {
  const root = document.createElement('div');
  history.replaceState(null, '', `#${hash}`);
  act(() => {
    setState({ booted: false, meta: null, profiles: [], profile: null, session: null, lastResult: null, route: hash, adultLock: 'locked' });
    boot();
    render(<App />, root);
  });
  return root;
}

const click = (el: Element | null | undefined): void => {
  if (!el) throw new Error('nothing to click');
  act(() => (el as HTMLElement).click());
};

beforeAll(async () => {
  // Both are lazy chunks in the app; load them first so a render shows them at once.
  await Promise.all([PinGateScreen.preload(), AdultScreen.preload()]);
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  repo.init();
  removeParentPin();
  repo.saveMeta({ uiLocale: 'mk' });
  saveProfile(createProfile({ name: 'Марко', age: 9, locale: 'mk', avatar: 'color.green' }, Date.now()));
  testOverrides.clockOffsetMs = 0;
});
afterEach(() => {
  testOverrides.clockOffsetMs = 0;
});

describe('every way into Grown-ups meets the gate', () => {
  it('a typed #/adult with no PIN yet: the grown-ups question, then setting a PIN', () => {
    const root = open('/adult');
    expect(root.querySelector('.adult')).toBeNull();
    const gate = root.querySelector('.pin-gate.setup')!;
    expect(gate.getAttribute('data-step')).toBe('gate');
    expect(gate.querySelector('.pin-question')!.textContent).toMatch(/^Колку е \d\d · \d\d\?$/);
  });

  it('a typed #/adult with a PIN: the PIN prompt with its own numpad and "Forgot PIN?"', async () => {
    await setParentPin('4827', 'setup');
    const root = open('/adult');
    expect(root.querySelector('.adult')).toBeNull();
    const gate = root.querySelector('.pin-gate.unlock')!;
    expect(gate.querySelector('h2')!.textContent).toContain('Внеси го ПИН-от');
    expect(gate.querySelectorAll('.numpad .key').length).toBeGreaterThanOrEqual(11);
    expect(gate.querySelector('.pin-link')!.textContent).toBe('Заборавен ПИН?');
  });

  it('the picker and Settings open the gate, never the dashboard', () => {
    const root = open('/');
    click(root.querySelector('.picker .grownups-btn'));
    expect(getState().route).toBe('/adult');
    expect(root.querySelector('.pin-gate')).not.toBeNull();
    expect(root.querySelector('.adult')).toBeNull();

    rememberTabChild(getState().profiles[0]!.id);
    const home = open('/settings');
    click(home.querySelector('.settings .grownups-btn'));
    expect(home.querySelector('.pin-gate')).not.toBeNull();
    expect(home.querySelector('.adult')).toBeNull();
  });

  it('typing the PIN on the numpad shows dots only, and the right one opens the area', async () => {
    await setParentPin('0482', 'setup');
    const root = open('/adult');
    for (const d of '0482') click([...root.querySelectorAll('.numpad .key')].find((k) => k.textContent === d));
    expect(root.querySelectorAll('.pin-dot.on')).toHaveLength(4);
    expect(root.querySelector('.pin-gate')!.textContent).not.toContain('0482');
    click(root.querySelector('.numpad .key-submit'));
    await act(async () => {
      for (let i = 0; i < 50 && getState().adultLock !== 'open'; i++) await new Promise((r) => setTimeout(r, 20));
    });
    expect(getState().adultLock).toBe('open');
    expect(root.querySelector('.adult')).not.toBeNull();
  });
});

describe('locking again', () => {
  it('leaving the area (back to the picker or a child screen) locks it', () => {
    const root = open('/adult');
    act(() => unlockAdult());
    expect(root.querySelector('.adult')).not.toBeNull();
    act(() => navigate('/'));
    expect(getState().adultLock).toBe('locked');
    act(() => navigate('/adult'));
    expect(root.querySelector('.adult')).toBeNull();
    expect(root.querySelector('.pin-gate')).not.toBeNull();
  });

  it('the browser back button locks it too', () => {
    startRouter();
    open('/adult');
    act(() => unlockAdult());
    act(() => {
      history.replaceState(null, '', '#/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(getState().route).toBe('/');
    expect(getState().adultLock).toBe('locked');
  });

  it('5 minutes without a tap or a key lock it; activity keeps it open', async () => {
    await setParentPin('4827', 'setup');
    const root = open('/adult');
    act(() => unlockAdult());
    testOverrides.clockOffsetMs = ADULT_IDLE_MS - 60_000;
    touchAdult();
    testOverrides.clockOffsetMs += ADULT_IDLE_MS - 1000;
    expect(checkAdultIdle()).toBe(false);
    expect(getState().adultLock).toBe('open');
    testOverrides.clockOffsetMs += 1000;
    act(() => {
      expect(checkAdultIdle()).toBe(true);
    });
    expect(getState().adultLock).toBe('idle');
    expect(root.querySelector('.adult')).toBeNull();
    expect(root.querySelector('.pin-gate .pin-msg')!.textContent).toBe('Повторно заклучено по 5 минути без користење.');
  });

  it('a reload locks it: the open state lives in memory only', () => {
    open('/adult');
    act(() => unlockAdult());
    const root = open('/adult');
    expect(root.querySelector('.pin-gate')).not.toBeNull();
    expect(root.querySelector('.adult')).toBeNull();
  });
});
