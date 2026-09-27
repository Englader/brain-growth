// @vitest-environment jsdom
/** Home-widget registry: band filter, order, rendering. */
import { render } from 'preact';
import { describe, expect, it } from 'vitest';
import { createProfile, type Profile } from '../src/core/profile';
import { HomeWidgets, homeWidgetsFor, registerHomeWidget, type HomeWidgetProps } from '../src/ui/homeWidgets';

const Card = (label: string) =>
  function W({ p }: HomeWidgetProps) {
    return <section class="card" data-w={label}>{p.name}</section>;
  };

describe('home widgets', () => {
  registerHomeWidget({ id: 'test.late', bands: ['B', 'C'], order: 20, Component: Card('late') });
  registerHomeWidget({ id: 'test.early', bands: ['A', 'B'], order: 10, Component: Card('early') });

  it('filters by band and sorts by order', () => {
    expect(homeWidgetsFor('B').map((w) => w.id)).toEqual(['test.early', 'test.late']);
    expect(homeWidgetsFor('A').map((w) => w.id)).toEqual(['test.early']);
    expect(homeWidgetsFor('C').map((w) => w.id)).toEqual(['test.late']);
    expect(() => registerHomeWidget({ id: 'test.late', bands: ['A'], order: 1, Component: Card('x') })).toThrow(/twice/);
  });

  it("renders the child's band's widgets with the profile", () => {
    const p: Profile = createProfile({ name: 'Марко', age: 9, locale: 'mk', avatar: 'color.green' }, 0);
    const root = document.createElement('div');
    render(<HomeWidgets p={p} />, root);
    expect([...root.querySelectorAll('[data-w]')].map((e) => `${e.getAttribute('data-w')}:${e.textContent}`)).toEqual(['early:Марко', 'late:Марко']);
    render(<HomeWidgets p={{ ...p, band: 'A' }} />, root);
    expect(root.querySelectorAll('[data-w]')).toHaveLength(1);
  });
});
