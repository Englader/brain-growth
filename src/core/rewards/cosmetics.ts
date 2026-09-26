/**
 * Cosmetic registry. Cosmetics are earned by PARTICIPATION (surprise drops,
 * quests, weekly challenge), never bought, never tied to accuracy, and never
 * affect play. Bands A/B get pet colours, hats and lily pads; Band C gets
 * themes and titles — nothing cute.
 */
import type { BandId } from '../types';

export type CosmeticSlot = 'color' | 'hat' | 'pad' | 'theme' | 'title';

export interface CosmeticDef {
  id: string;
  slot: CosmeticSlot;
  bands: readonly BandId[];
  /** 1 common … 3 rare. Drop weights 6 : 3 : 1. */
  rarity: 1 | 2 | 3;
  /** Colour (hex) for color/pad/theme; asset id for hats; unused for titles. */
  value: string;
  /** Available at profile creation. */
  starter?: boolean;
}

const AB: readonly BandId[] = ['A', 'B'];
const C: readonly BandId[] = ['C'];

export const COSMETICS: readonly CosmeticDef[] = [
  // pet colours (A/B) — starters are picked at profile creation
  { id: 'color.green', slot: 'color', bands: AB, rarity: 1, value: '#4caf50', starter: true },
  { id: 'color.blue', slot: 'color', bands: AB, rarity: 1, value: '#3b82f6', starter: true },
  { id: 'color.orange', slot: 'color', bands: AB, rarity: 1, value: '#f59e0b', starter: true },
  { id: 'color.pink', slot: 'color', bands: AB, rarity: 1, value: '#ec4899', starter: true },
  { id: 'color.purple', slot: 'color', bands: AB, rarity: 2, value: '#8b5cf6' },
  { id: 'color.teal', slot: 'color', bands: AB, rarity: 2, value: '#14b8a6' },
  { id: 'color.gold', slot: 'color', bands: AB, rarity: 3, value: '#eab308' },
  // hats
  { id: 'hat.cap', slot: 'hat', bands: AB, rarity: 1, value: 'cap' },
  { id: 'hat.flower', slot: 'hat', bands: AB, rarity: 1, value: 'flower' },
  { id: 'hat.party', slot: 'hat', bands: AB, rarity: 2, value: 'party' },
  { id: 'hat.wizard', slot: 'hat', bands: AB, rarity: 2, value: 'wizard' },
  { id: 'hat.crown', slot: 'hat', bands: AB, rarity: 3, value: 'crown' },
  // lily pads
  { id: 'pad.lily', slot: 'pad', bands: AB, rarity: 1, value: '#86efac', starter: true },
  { id: 'pad.sunset', slot: 'pad', bands: AB, rarity: 2, value: '#fdba74' },
  { id: 'pad.sky', slot: 'pad', bands: AB, rarity: 2, value: '#93c5fd' },
  { id: 'pad.star', slot: 'pad', bands: AB, rarity: 3, value: '#fde047' },
  // Band C: themes (accent) and titles
  { id: 'theme.indigo', slot: 'theme', bands: C, rarity: 1, value: '#818cf8', starter: true },
  { id: 'theme.emerald', slot: 'theme', bands: C, rarity: 1, value: '#34d399' },
  { id: 'theme.amber', slot: 'theme', bands: C, rarity: 2, value: '#fbbf24' },
  { id: 'theme.crimson', slot: 'theme', bands: C, rarity: 2, value: '#f87171' },
  { id: 'theme.cyan', slot: 'theme', bands: C, rarity: 3, value: '#22d3ee' },
  { id: 'title.estimator', slot: 'title', bands: C, rarity: 1, value: '' },
  { id: 'title.navigator', slot: 'title', bands: C, rarity: 1, value: '' },
  { id: 'title.strategist', slot: 'title', bands: C, rarity: 2, value: '' },
  { id: 'title.analyst', slot: 'title', bands: C, rarity: 2, value: '' },
  { id: 'title.architect', slot: 'title', bands: C, rarity: 3, value: '' },
];

const byId = new Map(COSMETICS.map((c) => [c.id, c]));

export function getCosmetic(id: string): CosmeticDef | undefined {
  return byId.get(id);
}

export function starterCosmetics(band: BandId, slot: CosmeticSlot): CosmeticDef[] {
  return COSMETICS.filter((c) => c.starter && c.slot === slot && c.bands.includes(band));
}

export function registerCosmetic(def: CosmeticDef): void {
  if (byId.has(def.id)) throw new Error(`cosmetic ${def.id} registered twice`);
  (COSMETICS as CosmeticDef[]).push(def);
  byId.set(def.id, def);
}
