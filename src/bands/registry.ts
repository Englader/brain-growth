/**
 * Band registry. Adding a band = one config object + a theme block in
 * styles/themes.css + (optionally) Home/Results variants. Nothing in the engine.
 */
import type { BandId } from '../core/types';
import type { BandConfig } from './types';

export const BAND_A: BandConfig = {
  id: 'A',
  ages: [5, 7],
  targetP: 0.88,
  allowReading: false,
  maxReturns: 2,
  sessionItems: 8,
  quickItems: 3,
  targetMinutes: 3,
  reviewFloorGrade: 0,
  timersAllowed: false,
  theme: 'meadow',
  input: 'hops',
  feedback: 'visual',
  audio: 'always',
  companion: 'pet',
  hopper: 'frog',
  rewards: 'gifts',
  showStats: false,
};

export const BAND_B: BandConfig = {
  id: 'B',
  ages: [8, 11],
  targetP: 0.85,
  allowReading: true,
  maxReturns: 3,
  sessionItems: 14,
  quickItems: 3,
  targetMinutes: 7,
  reviewFloorGrade: 1,
  timersAllowed: true,
  theme: 'lagoon',
  input: 'numpad',
  feedback: 'short',
  audio: 'onTap',
  companion: 'pet',
  hopper: 'frog',
  rewards: 'gifts',
  showStats: false,
};

export const BAND_C: BandConfig = {
  id: 'C',
  ages: [12, 14],
  targetP: 0.82,
  allowReading: true,
  maxReturns: 3,
  sessionItems: 18,
  quickItems: 3,
  targetMinutes: 12,
  reviewFloorGrade: 3,
  timersAllowed: true,
  theme: 'slate',
  input: 'numpad',
  feedback: 'worked',
  audio: 'off',
  companion: 'none',
  hopper: 'marker',
  rewards: 'unlocks',
  showStats: true,
};

const BANDS = new Map<BandId, BandConfig>([
  ['A', BAND_A],
  ['B', BAND_B],
  ['C', BAND_C],
]);

export function getBand(id: BandId): BandConfig {
  const b = BANDS.get(id);
  if (!b) throw new Error(`unknown band ${id}`);
  return b;
}

export function allBands(): BandConfig[] {
  return [...BANDS.values()];
}
