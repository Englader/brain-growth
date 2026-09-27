/**
 * Locale bundles load on demand (i18n/locales.ts, app/localeActions.ts,
 * DESIGN §1.12 "Loading"): one fetch per bundle, a screen never shows raw
 * keys while a language is on its way, and a switch waits for its bundle,
 * then applies (or is superseded, or fails and may be retried).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLocale, whenLocaleReady } from '../src/app/localeActions';
import { saveProfile } from '../src/app/persist';
import { repo } from '../src/app/services';
import { getState, setState } from '../src/app/store';
import { createProfile } from '../src/core/profile';
import { makeT, speakingLocale, tk } from '../src/i18n/i18n';
import { isLocaleLoaded, loadLocale, registerLocale, type LocaleConfig } from '../src/i18n/locales';

type Bundle = Awaited<ReturnType<LocaleConfig['load']>>;

/** A test locale whose bundle arrives when the test says so. */
function slowLocale(id: string): { load: ReturnType<typeof vi.fn>; arrive: () => Promise<void>; fail: () => Promise<void> } {
  let resolve!: (b: Bundle) => void;
  let reject!: (e: Error) => void;
  const load = vi.fn(
    () =>
      new Promise<Bundle>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  registerLocale({
    id,
    bcp47: 'en-GB',
    nativeName: `Test ${id}`,
    short: id.toUpperCase(),
    numbers: { bcp47: 'en-GB', decimal: '.', group: ',', minimumGroupingDigits: 1, minus: '−', percent: '%' },
    ops: { '+': '+', '-': '−', '*': '×', '/': '÷', '=': '=' },
    speech: [],
    load,
  });
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  return {
    load,
    arrive: async () => {
      resolve([{ default: { common: { back: `${id} back` } } }, { default: { names: [], templates: {} } }]);
      await tick();
    },
    fail: async () => {
      reject(new Error('offline'));
      await tick();
    },
  };
}

afterEach(() => setState({ localePending: null }));

describe('loading a bundle', () => {
  it('fetches once however many ask, then is in', async () => {
    const x = slowLocale('xa');
    const a = loadLocale('xa');
    const b = loadLocale('xa');
    expect(x.load).toHaveBeenCalledTimes(1);
    expect(isLocaleLoaded('xa')).toBe(false);
    await x.arrive();
    await Promise.all([a, b]);
    expect(isLocaleLoaded('xa')).toBe(true);
    expect(tk('xa', 'common.back')).toBe('xa back');
  });

  it('while a language is on its way, text comes from one that is in: never a raw key', () => {
    slowLocale('xb');
    expect(speakingLocale('xb')).toBe('en');
    expect(tk('xb', 'common.back')).toBe('Back');
    // A translator for it starts the fetch itself.
    const t = makeT('xb', 'B');
    expect(t('common.back')).toBe('Back');
  });

  it('a failed fetch can be retried', async () => {
    const x = slowLocale('xc');
    const first = loadLocale('xc');
    await x.fail();
    await expect(first).rejects.toThrow('offline');
    const again = loadLocale('xc');
    expect(x.load).toHaveBeenCalledTimes(2);
    await x.arrive();
    await again;
    expect(isLocaleLoaded('xc')).toBe(true);
  });
});

describe('a language switch waits for its bundle', () => {
  it('applies at once when the bundle is already in (after the idle prefetch)', () => {
    const apply = vi.fn();
    whenLocaleReady('mk', apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(getState().localePending).toBeNull();
  });

  it('is pending (the toggle shows it busy) until the bundle arrives, then applies once', async () => {
    const x = slowLocale('xd');
    const apply = vi.fn();
    whenLocaleReady('xd', apply);
    expect(getState().localePending).toBe('xd');
    expect(apply).not.toHaveBeenCalled();
    await x.arrive();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(getState().localePending).toBeNull();
  });

  it('a newer choice supersedes a pending one', async () => {
    const x = slowLocale('xe');
    const late = vi.fn();
    const now = vi.fn();
    whenLocaleReady('xe', late);
    whenLocaleReady('en', now);
    expect(now).toHaveBeenCalledTimes(1);
    expect(getState().localePending).toBeNull();
    await x.arrive();
    expect(late).not.toHaveBeenCalled();
  });

  it('a failed fetch clears the pending state and reports it', async () => {
    const x = slowLocale('xf');
    const apply = vi.fn();
    const failed = vi.fn();
    whenLocaleReady('xf', apply, failed);
    await x.fail();
    expect(apply).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(getState().localePending).toBeNull();
  });
});

describe('the first screen’s language', () => {
  it('is the active child’s, else the device’s choice before any child, else the browser’s', () => {
    repo.init();
    repo.saveMeta({ activeProfileId: null, uiLocale: 'mk' });
    expect(startLocale()).toBe('mk');
    const kid = saveProfile(createProfile({ name: 'Ema', age: 9, locale: 'en', avatar: 'color.green' }, Date.now()));
    repo.saveMeta({ activeProfileId: kid.id });
    expect(startLocale()).toBe('en');
  });
});

describe('before any bundle is in', () => {
  it('text is empty, not a key (the boot splash has no text)', async () => {
    vi.resetModules();
    const fresh = await import('../src/i18n/i18n');
    expect(fresh.tk('mk', 'common.back')).toBe('');
    expect(fresh.speakingLocale('mk')).toBeNull();
  });
});
