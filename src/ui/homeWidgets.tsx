/**
 * Home-widget registry: cards a feature adds to the home screens (e.g. the
 * weekly challenge) without editing Home.tsx. A widget registers once, from
 * its own module listed under its slot in src/ui/widgets/index.ts:
 *
 *   registerHomeWidget({ id: 'weekly', bands: ['A', 'B', 'C'], order: 10, Component: WeeklyCard });
 *
 * Each home renders its band's widgets in `order`, between the modes and the
 * daily quest card. A widget renders null when it has nothing to show.
 */
import type { ComponentType, JSX } from 'preact';
import type { Profile } from '../core/profile';
import type { BandId } from '../core/types';

export interface HomeWidgetProps {
  p: Profile;
}

export interface HomeWidgetDef {
  id: string;
  bands: readonly BandId[];
  /** Position among widgets (lower first). */
  order: number;
  Component: ComponentType<HomeWidgetProps>;
}

const widgets = new Map<string, HomeWidgetDef>();

export function registerHomeWidget(def: HomeWidgetDef): void {
  if (widgets.has(def.id)) throw new Error(`home widget ${def.id} registered twice`);
  widgets.set(def.id, def);
}

/** Widgets for a band, in order. */
export function homeWidgetsFor(band: BandId): HomeWidgetDef[] {
  return [...widgets.values()].filter((w) => w.bands.includes(band)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function HomeWidgets({ p }: HomeWidgetProps): JSX.Element | null {
  const list = homeWidgetsFor(p.band);
  if (!list.length) return null;
  return (
    <div class="home-widgets">
      {list.map(({ id, Component }) => (
        <Component key={id} p={p} />
      ))}
    </div>
  );
}
