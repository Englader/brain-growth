// @vitest-environment jsdom
/**
 * The start flow (DESIGN A-29): with players, every fresh open starts on
 * "Who's playing?"; a reload in the same tab keeps the child who was playing
 * (sessionStorage); with none, the new-player form. Every home has a
 * switch-player button at the top and a year bar that pages through the years
 * with content and remembers the choice on the child.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import '../src/modes';
import { boot, selectProfile } from '../src/app/actions';
import { App } from '../src/app/App';
import { saveProfile } from '../src/app/persist';
import { repo } from '../src/app/services';
import { getState, setState } from '../src/app/store';
import { rememberTabChild, tabChild } from '../src/app/tab';
import { glickoElo } from '../src/core/engine/glicko';
import { replay } from '../src/core/engine/replay';
import { EVENTS } from '../src/core/log/types';
import { createProfile, type Profile } from '../src/core/profile';
import { GRAPH } from '../src/core/skills';

function placed(name: string, age: number, g: number): Profile {
  const t = Date.now();
  const base = createProfile({ name, age, locale: 'mk', avatar: 'color.green' }, t - 60_000);
  const skills = replay({ graph: GRAPH, model: glickoElo }, [{ type: 'event', ts: t - 30_000, sid: null, name: EVENTS.PLACEMENT_DONE, data: { g, sd: 0.3 } }]);
  return { ...base, skills, placement: { done: true, state: null, g, sd: 0.3 } };
}

/** A fresh page: empty store, then boot() as main.tsx runs it, then the App. */
function open(): HTMLElement {
  const root = document.createElement('div');
  history.replaceState(null, '', '#/');
  act(() => {
    setState({ booted: false, meta: null, profiles: [], profile: null, session: null, lastResult: null, route: '/' });
    boot();
    render(<App />, root);
  });
  return root;
}

const click = (el: Element | null | undefined): void => {
  if (!el) throw new Error('nothing to click');
  act(() => (el as HTMLElement).click());
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  repo.init();
});

describe('who is playing', () => {
  it('with no player, the app opens the new-player form', () => {
    const root = open();
    expect(root.querySelector('.create')).not.toBeNull();
    expect(root.querySelector('.picker')).toBeNull();
  });

  it('a fresh open shows the picker even though a child played last; a reload in the same tab keeps her', () => {
    const ana = saveProfile(placed('Ана', 6, 1.2));
    const marko = saveProfile(placed('Марко', 9, 3.5));
    // The device's last child (and the picker's language, chosen on the new-player form).
    repo.saveMeta({ activeProfileId: marko.id, uiLocale: 'mk' });

    let root = open();
    expect(getState().profile).toBeNull();
    const cards = [...root.querySelectorAll('.player-card')];
    expect(cards.map((c) => c.querySelector('.player-name')!.textContent)).toEqual(['Ана', 'Марко']);
    expect(cards.map((c) => c.querySelector('.player-year')!.textContent)).toEqual(['1. одделение', '4. одделение']);
    expect(root.querySelector('.add-player')!.textContent).toContain('Нов играч');
    expect(root.querySelector('.picker .hold-btn')).not.toBeNull();

    click(cards[0]);
    expect(getState().profile?.id).toBe(ana.id);
    expect(tabChild()).toBe(ana.id);

    // Reload: same tab, same child, straight to her home.
    root = open();
    expect(getState().profile?.id).toBe(ana.id);
    expect(root.querySelector('.home-a')).not.toBeNull();

    // A new tab (no session storage): the picker again.
    sessionStorage.clear();
    root = open();
    expect(getState().profile).toBeNull();
    expect(root.querySelector('.picker')).not.toBeNull();
  });

  it('every home switches player from the top, back to the picker', () => {
    for (const [name, age, g, cls] of [['Ана', 6, 1.2, '.home-a'], ['Марко', 9, 3.5, '.home-b'], ['Стефан', 13, 7, '.home-c']] as const) {
      localStorage.clear();
      sessionStorage.clear();
      repo.init();
      const kid = saveProfile(placed(name, age, g));
      rememberTabChild(kid.id);
      const root = open();
      expect(root.querySelector(cls), name).not.toBeNull();
      const who = root.querySelector('.topbar .who-btn')!;
      expect(who.getAttribute('aria-label')).toBe(`${name}: смени играч`);
      expect(who.textContent).toContain(name);
      click(who);
      expect(getState().profile).toBeNull();
      expect(tabChild()).toBeNull();
      expect(root.querySelector('.picker')).not.toBeNull();
    }
  });
});

describe('the year bar', () => {
  it('starts on the child’s own year, pages up and down through the years with content, and remembers the choice', () => {
    const lena = saveProfile(placed('Лена', 10, 4.5));
    rememberTabChild(lena.id);
    const root = open();
    const label = (): string => root.querySelector('.year-bar .yb-label')!.textContent!;
    expect(label()).toBe('5. одделение');
    expect(root.querySelector('.year-bar .yb-own')!.textContent).toContain('твое одделение');
    click(root.querySelector('.year-bar .yb-next'));
    expect(label()).toBe('6. одделение');
    expect(getState().profile!.year).toBe(6);
    expect(root.querySelector('.year-bar .yb-own')).toBeNull();
    click(root.querySelector('.year-bar .yb-prev'));
    click(root.querySelector('.year-bar .yb-prev'));
    expect(label()).toBe('4. одделение');
    // Today's challenges follow the year: year 4 has fractions next to other skills, so a focus can be drawn.
    expect(root.querySelector('.today-b h2')!.textContent).toBe('Денешни предизвици');
    expect(root.querySelector('.today-b .muted')!.textContent).toContain('4. одделение');
    // Remembered on the profile: a reload lands on year 4.
    const again = open();
    expect(again.querySelector('.year-bar .yb-label')!.textContent).toBe('4. одделение');
  });

  it('modes with nothing in the year move to one card that offers the nearest year that has some', () => {
    const lena = saveProfile({ ...placed('Лена', 10, 4.5), year: 5 });
    rememberTabChild(lena.id);
    const root = open();
    expect(root.querySelector('.mode-card.mode-balance')).toBeNull();
    const chip = root.querySelector('.elsewhere .yb-elsewhere.mode-balance')!;
    expect(chip.textContent).toContain('Вага во 7. одделение');
    expect(root.querySelector('.elsewhere h2')!.textContent).toBe('Во други одделенија');
    click(chip);
    expect(getState().profile!.year).toBe(7);
    expect(root.querySelector('.mode-card.mode-balance')).not.toBeNull();
    expect(root.querySelector('.elsewhere .mode-balance')).toBeNull();
  });

  it('selecting a child from the picker opens her home on her remembered year', () => {
    const kid = saveProfile({ ...placed('Марко', 9, 3.5), year: 2 });
    const root = open();
    click(root.querySelector('.player-card'));
    expect(root.querySelector('.year-bar .yb-label')!.textContent).toBe('2. одделение');
    selectProfile(kid.id);
  });
});
