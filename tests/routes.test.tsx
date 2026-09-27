// @vitest-environment jsdom
/**
 * Generic mode routes (App.tsx): /intro/<id> renders the mode's intro;
 * /play/<id> renders an engine mode only with its session, a standalone
 * mode (engine: false) without one; hidden modes bounce home. Also the Band A
 * icon tray (ModeDef.homeA).
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';
import '../src/modes';
import { startSessionFor } from '../src/app/actions';
import { App } from '../src/app/App';
import { saveProfile } from '../src/app/persist';
import { repo } from '../src/app/services';
import { setState } from '../src/app/store';
import { createProfile, type Profile } from '../src/core/profile';
import { registerMode } from '../src/modes/registry';

let kidB: Profile;
let kidA: Profile;

beforeAll(() => {
  registerMode({
    id: 'standalone', order: 90, titleKey: 'mode.hop.title', descKey: 'mode.hop.desc', icon: 'dice', requires: [], bands: ['A', 'B'],
    engine: false, homeA: true, intro: () => <p class="t-intro">intro</p>, Component: () => <p class="t-standalone">play</p>,
  });
  registerMode({
    id: 'hidden', order: 91, titleKey: 'mode.hop.title', descKey: 'mode.hop.desc', icon: 'dice', requires: [], bands: ['C'],
    engine: false, intro: () => <p class="t-hidden">hidden</p>, Component: () => <p class="t-hidden">hidden</p>,
  });
  repo.init();
  kidB = saveProfile(createProfile({ name: 'Марко', age: 9, locale: 'mk', avatar: 'color.green' }, Date.now()));
  kidA = saveProfile(createProfile({ name: 'Ана', age: 6, locale: 'mk', avatar: 'color.green' }, Date.now()));
});

function show(route: string, patch: Parameters<typeof setState>[0] = {}): HTMLElement {
  const root = document.createElement('div');
  history.replaceState(null, '', `#${route}`);
  act(() => {
    setState({ booted: true, meta: repo.meta(), profiles: [kidB, kidA], profile: kidB, session: null, route });
    setState(patch);
    render(<App />, root);
  });
  return root;
}

describe('mode routes', () => {
  it('/intro/<id> renders the registered intro', () => {
    expect(show('/intro/standalone').querySelector('.t-intro')).not.toBeNull();
  });

  it('/play/<id> renders a standalone mode without a store session', () => {
    expect(show('/play/standalone').querySelector('.t-standalone')).not.toBeNull();
  });

  it('/play/<id> needs a matching session for an engine mode', () => {
    expect(show('/play/hop').querySelector('.play')).toBeNull();
    const session = startSessionFor(kidB, 'hop')!;
    expect(show('/play/hop', { session }).querySelector('.play')).not.toBeNull();
  });

  it('modes hidden from this child (band, flag) bounce home', () => {
    const root = show('/intro/hidden');
    expect(root.querySelector('.t-hidden')).toBeNull();
    expect(root.querySelector('.home')).not.toBeNull();
  });

  it('Band A shows homeA modes as icon tiles labelled by their title', () => {
    const root = show('/', { profile: kidA });
    const tiles = [...root.querySelectorAll('.mode-tray .mode-tile')];
    expect(tiles.map((b) => b.className)).toEqual(['btn mode-tile mode-standalone']);
    expect(tiles[0]!.getAttribute('aria-label')).toBeTruthy();
  });
});
