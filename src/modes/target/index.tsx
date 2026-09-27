/**
 * Registers the Target ("Make it") mode (plan step 4). Ships ON (DESIGN
 * A-26); `mode.target` stays a per-child switch in the adult view.
 *
 * The board UI is a separate chunk, loaded when the mode opens (the service
 * worker precaches every chunk, so it works offline). The deal generator and
 * solver stay in the main bundle: the engine generates items synchronously.
 */
import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { now } from '../../app/services';
import { getBand } from '../../bands/registry';
import { glickoElo } from '../../core/engine/glicko';
import { classify } from '../../core/engine/scheduler';
import type { Profile } from '../../core/profile';
import { createRng } from '../../core/rng';
import { GRAPH } from '../../core/skills';
import { registerMode } from '../registry';

let loaded: ComponentType | null = null;

function TargetModeLazy(): JSX.Element {
  const [C, setC] = useState<ComponentType | null>(() => loaded);
  useEffect(() => {
    if (C) return undefined;
    let live = true;
    void import('./TargetMode').then((m) => {
      loaded = m.TargetMode;
      if (live) setC(() => m.TargetMode);
    });
    return () => {
      live = false;
    };
  }, []);
  return C ? <C /> : <div class="play target-play" />;
}

/**
 * Whether a session would have a deal to serve this child now: some skill
 * with a deal generator this band may use (Band A: the non-reading make-10
 * board) is unlocked and schedulable. Same rules as the engine's scheduler.
 */
export function hasTargetWork(p: Profile): boolean {
  const band = getBand(p.band);
  const b = classify({
    graph: GRAPH,
    model: glickoElo,
    states: p.skills,
    now: now(),
    rng: createRng(0),
    eligibility: { requires: ['deal'], allowReading: band.allowReading, reviewFloor: band.reviewFloorGrade },
    history: [],
    newIntroduced: 0,
  });
  return b.frontier.length + b.review.length + b.maintain.length > 0;
}

const PLANNED = { A: 5, B: 8, C: 10 } as const;

registerMode({
  id: 'target',
  order: 20,
  titleKey: 'target.title',
  descKey: 'target.desc',
  icon: 'cards',
  requires: ['deal'],
  bands: ['A', 'B', 'C'],
  flag: 'mode.target',
  homeA: true,
  ready: (p) => p.placement.done && hasTargetWork(p),
  notReadyKey: 'target.notReady',
  plannedItems: (band, opts) => (opts.quick ? 3 : PLANNED[band.id]),
  maxReturns: () => 0,
  Component: TargetModeLazy,
});
