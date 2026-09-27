// @vitest-environment jsdom
/**
 * Loading on demand (DESIGN §3.2 "Size"): lazy screens (src/modes/lazy.tsx),
 * on-demand generators (src/core/items/generators/registry.ts) and the play
 * screen that waits for them, and the language toggle's busy state.
 */
import { render, type ComponentType } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/modes';
import { setState } from '../src/app/store';
import { createRng } from '../src/core/rng';
import {
  allGenerators,
  declareGenerators,
  generatorLoaded,
  generatorsReadyFor,
  getGenerator,
  hasGenerator,
  loadGeneratorsFor,
  registerGenerator,
} from '../src/core/items/generators/registry';
import type { Capability, GeneratorDef } from '../src/core/items/types';
import { lazyScreen, ModeScreen, preloadMode } from '../src/modes/lazy';
import { allModes, getMode } from '../src/modes/registry';
import type { ModeDef } from '../src/modes/types';
import { LangToggle } from '../src/ui/components/common';

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const gen = (id: string, capabilities: Capability[]): GeneratorDef<any> => ({
  id,
  version: 3,
  capabilities,
  generate: () => ({ level: 0.5 }) as never,
});

afterEach(() => setState({ localePending: null }));

describe('on-demand generators', () => {
  it('every declared generator is loaded in tests, with its declared capabilities', () => {
    for (const g of allGenerators()) expect(generatorLoaded(g.id), g.id).toBe(true);
    // Target's deal generators are on demand (not in the start-up bundle) yet playable from the start.
    expect(hasGenerator('makeIt')).toBe(true);
  });

  it('are playable and schedulable before loading, generate only after, and load once', async () => {
    const d = deferred<GeneratorDef<any>[]>();
    const load = vi.fn(() => d.promise);
    declareGenerators({ declared: [{ id: 'test.lazyA', capabilities: ['testCap' as Capability, 'numeric'] }], load });
    expect(hasGenerator('test.lazyA')).toBe(true);
    expect(getGenerator('test.lazyA').capabilities).toEqual(['testCap', 'numeric']);
    expect(generatorLoaded('test.lazyA')).toBe(false);
    expect(generatorsReadyFor(['testCap' as Capability])).toBe(false);
    expect(() => getGenerator('test.lazyA').generate(0.5, createRng(1), {})).toThrow(/not loaded/);
    // Hop's own generators never wait: nothing a number-line mode serves is on demand.
    expect(generatorsReadyFor(['numberLine'])).toBe(true);

    const a = loadGeneratorsFor(['testCap' as Capability]);
    const b = loadGeneratorsFor(['testCap' as Capability, 'numeric']);
    expect(load).toHaveBeenCalledTimes(1);
    d.resolve([gen('test.lazyA', ['numeric', 'testCap' as Capability])]);
    await Promise.all([a, b]);
    expect(generatorLoaded('test.lazyA')).toBe(true);
    expect(generatorsReadyFor(['testCap' as Capability])).toBe(true);
    expect(getGenerator('test.lazyA').version).toBe(3);
  });

  it('a failed fetch can be retried', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([gen('test.lazyB', ['testCapB' as Capability])]);
    declareGenerators({ declared: [{ id: 'test.lazyB', capabilities: ['testCapB' as Capability] }], load });
    await expect(loadGeneratorsFor(['testCapB' as Capability])).rejects.toThrow('offline');
    await loadGeneratorsFor(['testCapB' as Capability]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(generatorLoaded('test.lazyB')).toBe(true);
  });

  it('a declaration must match its module: same capabilities, nothing undeclared', async () => {
    declareGenerators({ declared: [{ id: 'test.lazyC', capabilities: ['testCapC' as Capability] }], load: async () => [gen('test.lazyC', ['numeric'])] });
    await expect(loadGeneratorsFor(['testCapC' as Capability])).rejects.toThrow(/capabilities differ/);
    declareGenerators({ declared: [{ id: 'test.lazyD', capabilities: ['testCapD' as Capability] }], load: async () => [gen('test.lazyD', ['testCapD' as Capability]), gen('test.extra', ['testCapD' as Capability])] });
    await expect(loadGeneratorsFor(['testCapD' as Capability])).rejects.toThrow(/not declared/);
    const builtin = getGenerator('count');
    expect(() => registerGenerator(gen(builtin.id, [...builtin.capabilities]))).toThrow(/twice/);
  });
});

describe('lazy screens', () => {
  it('render nothing but the background until the chunk is in, then the screen', async () => {
    const d = deferred<ComponentType>();
    const Screen = lazyScreen(() => d.promise, { placeholderClass: 'play lazy-screen' });
    const root = document.createElement('div');
    act(() => render(<Screen />, root));
    expect(root.querySelector('.play.lazy-screen')!.getAttribute('aria-busy')).toBe('true');
    expect(root.textContent).toBe('');
    d.resolve(() => <p class="loaded">ok</p>);
    await flush();
    expect(root.querySelector('.loaded')).not.toBeNull();
    // Cached: the next mount renders at once.
    const again = document.createElement('div');
    act(() => render(<Screen />, again));
    expect(again.querySelector('.loaded')).not.toBeNull();
  });

  it('a failed fetch offers a retry, which loads it', async () => {
    const load = vi.fn<() => Promise<ComponentType>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(() => <p class="loaded">ok</p>);
    const Screen = lazyScreen(load);
    const root = document.createElement('div');
    act(() => render(<Screen />, root));
    await flush();
    const alert = root.querySelector('[role="alert"]')!;
    expect(alert.querySelectorAll('button')).toHaveLength(2); // try again, home
    act(() => (alert.querySelector('.btn.primary') as HTMLButtonElement).click());
    await flush();
    expect(root.querySelector('.loaded')).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('every mode but Hop registers lazy screens; registration metadata stays eager', () => {
    for (const m of allModes()) {
      const screens = [m.Component, m.intro].filter(Boolean) as Array<ComponentType & { preload?: unknown }>;
      if (m.id === 'hop') expect(screens.every((c) => c.preload === undefined)).toBe(true);
      else for (const c of screens) expect(typeof c.preload, m.id).toBe('function');
      expect(m.titleKey && m.icon, m.id).toBeTruthy();
    }
  });
});

describe('a play screen waits for the generators its mode may serve', () => {
  it('renders once they are in; preloadMode starts the fetch', async () => {
    const d = deferred<GeneratorDef<any>[]>();
    const load = vi.fn(() => d.promise);
    declareGenerators({ declared: [{ id: 'test.lazyE', capabilities: ['testCapE' as Capability] }], load });
    const mode: ModeDef = { ...getMode('hop')!, id: 'test.e', requires: ['testCapE' as Capability], placement: false };
    preloadMode(mode);
    expect(load).toHaveBeenCalledTimes(1);
    const root = document.createElement('div');
    act(() => render(<ModeScreen mode={mode} screen={() => <p class="board">board</p>} />, root));
    expect(root.querySelector('.board')).toBeNull();
    d.resolve([gen('test.lazyE', ['testCapE' as Capability])]);
    await flush();
    expect(root.querySelector('.board')).not.toBeNull();
  });
});

describe('language toggle', () => {
  it('shows a language whose bundle is on its way as busy, not yet pressed', () => {
    const root = document.createElement('div');
    act(() => {
      setState({ booted: true, profile: null, meta: { uiLocale: 'en' } as never, localePending: 'mk' });
      render(<LangToggle />, root);
    });
    const mk = root.querySelector('button[lang="mk-MK"]')!;
    expect(mk.getAttribute('aria-busy')).toBe('true');
    expect(mk.getAttribute('aria-pressed')).toBe('false');
    expect(mk.className).toContain('busy');
    expect(mk.getAttribute('aria-label')).toBe('Македонски: loading…');
    expect(root.querySelector('button[lang="en-US"]')!.getAttribute('aria-pressed')).toBe('true');
  });
});
