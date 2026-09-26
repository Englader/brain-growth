/**
 * Mode registry (no component imports here, so domain code can use it without
 * pulling in UI). Modes register themselves from src/modes/index.ts.
 */
import { getBand } from '../bands/registry';
import { isEnabled } from '../core/flags';
import type { Profile } from '../core/profile';
import type { ModeId } from '../core/types';
import type { ModeDef } from './types';

const modes = new Map<ModeId, ModeDef>();

export function registerMode(def: ModeDef): void {
  if (modes.has(def.id)) throw new Error(`mode ${def.id} registered twice`);
  modes.set(def.id, def);
}

export function getMode(id: ModeId): ModeDef | undefined {
  return modes.get(id);
}

export function allModes(): ModeDef[] {
  return [...modes.values()];
}

/** Modes visible to this child: band, timers policy and feature flags applied. */
export function modesFor(profile: Profile, deviceFlags: Record<string, boolean>): ModeDef[] {
  const band = getBand(profile.band);
  return allModes().filter(
    (m) =>
      m.bands.includes(profile.band) &&
      (!m.timed || band.timersAllowed) &&
      (!m.flag || isEnabled(m.flag, profile.flags, deviceFlags)),
  );
}
