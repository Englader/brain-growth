/**
 * Cosmetic registry. Cosmetics are earned by PARTICIPATION (surprise drops,
 * quests, weekly challenge), never bought, never tied to accuracy, and never
 * affect play. Bands A/B get pet colours, hats and lily pads; Band C gets
 * themes and titles — nothing cute.
 */
import { SEASON_COSMETICS } from '../seasons';
import type { BandId } from '../types';

export type CosmeticSlot = 'color' | 'hat' | 'pad' | 'theme' | 'title';

/**
 * How a cosmetic is earned. 'drop' (the default when absent) joins the random
 * drop pool and quest gifts; 'weekly' set pieces come only from the weekly
 * challenge; 'season' items only drop in their season (src/core/seasons.ts).
 */
export type CosmeticSource = 'drop' | 'weekly' | 'season';

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
  /** Default 'drop'. */
  source?: CosmeticSource;
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
  // Band C: themes (accent) and titles. Four accents to pick from at creation, as Bands A/B get four
  // frog colours; the rest drop.
  { id: 'theme.indigo', slot: 'theme', bands: C, rarity: 1, value: '#818cf8', starter: true },
  { id: 'theme.emerald', slot: 'theme', bands: C, rarity: 1, value: '#34d399', starter: true },
  { id: 'theme.amber', slot: 'theme', bands: C, rarity: 2, value: '#fbbf24', starter: true },
  { id: 'theme.crimson', slot: 'theme', bands: C, rarity: 2, value: '#f87171', starter: true },
  { id: 'theme.cyan', slot: 'theme', bands: C, rarity: 3, value: '#22d3ee' },
  { id: 'title.estimator', slot: 'title', bands: C, rarity: 1, value: '' },
  { id: 'title.navigator', slot: 'title', bands: C, rarity: 1, value: '' },
  { id: 'title.strategist', slot: 'title', bands: C, rarity: 2, value: '' },
  { id: 'title.analyst', slot: 'title', bands: C, rarity: 2, value: '' },
  { id: 'title.architect', slot: 'title', bands: C, rarity: 3, value: '' },
  // Feature cosmetics (ids `<feature>.*`, strings `cos.<feature>.*`), each under its own anchor:
  // ── slot: frac ──
  // ── slot: hint ──
  // ── slot: pilot ──
  // ── slot: storage ──
  // ── slot: weekly ──
  // Weekly set pieces (src/core/weekly.ts): patterned lily-pad sets for A (value is a CSS background),
  // pet colours for B, accent themes for C. Never dropped at random.
  { id: 'weekly.counting.pad', slot: 'pad', bands: AB, rarity: 2, source: 'weekly', value: 'radial-gradient(circle at 24% 24%, #fff 0 8%, transparent 9%), radial-gradient(circle at 76% 24%, #fff 0 8%, transparent 9%), radial-gradient(circle at 24% 76%, #fff 0 8%, transparent 9%), radial-gradient(circle at 76% 76%, #fff 0 8%, transparent 9%), #c4b5fd' },
  { id: 'weekly.bonds.pad', slot: 'pad', bands: AB, rarity: 2, source: 'weekly', value: 'linear-gradient(90deg, #fda4af 0 50%, #fecdd3 50%)' },
  { id: 'weekly.bridgeTen.pad', slot: 'pad', bands: AB, rarity: 2, source: 'weekly', value: 'radial-gradient(ellipse 42% 32% at 50% 100%, transparent 0 66%, #0e7490 68% 86%, transparent 88%), #a5f3fc' },
  { id: 'weekly.doubles.pad', slot: 'pad', bands: AB, rarity: 2, source: 'weekly', value: 'linear-gradient(90deg, #d9f99d 0 48.5%, #a3e635 48.5% 51.5%, #d9f99d 51.5%)' },
  { id: 'weekly.tens.pad', slot: 'pad', bands: AB, rarity: 2, source: 'weekly', value: 'repeating-linear-gradient(90deg, #fde68a 0 6px, #fcd34d 6px 11px)' },
  { id: 'weekly.numberLine.pad', slot: 'pad', bands: AB, rarity: 2, source: 'weekly', value: 'linear-gradient(transparent 74%, #0284c7 74% 80%, transparent 80%), #bae6fd' },
  { id: 'weekly.mixed.pad', slot: 'pad', bands: AB, rarity: 2, source: 'weekly', value: 'conic-gradient(#fecaca, #fde68a, #bbf7d0, #bfdbfe, #ddd6fe, #fecaca)' },
  { id: 'weekly.bridgeTen.color', slot: 'color', bands: AB, rarity: 2, source: 'weekly', value: '#06b6d4' },
  { id: 'weekly.doubles.color', slot: 'color', bands: AB, rarity: 2, source: 'weekly', value: '#84cc16' },
  { id: 'weekly.tens.color', slot: 'color', bands: AB, rarity: 2, source: 'weekly', value: '#ea580c' },
  { id: 'weekly.bridgeHundred.color', slot: 'color', bands: AB, rarity: 2, source: 'weekly', value: '#f43f5e' },
  { id: 'weekly.tables.color', slot: 'color', bands: AB, rarity: 2, source: 'weekly', value: '#4f46e5' },
  { id: 'weekly.bigNumbers.color', slot: 'color', bands: AB, rarity: 2, source: 'weekly', value: '#0f766e' },
  { id: 'weekly.numberLine.color', slot: 'color', bands: AB, rarity: 2, source: 'weekly', value: '#38bdf8' },
  { id: 'weekly.belowZero.color', slot: 'color', bands: AB, rarity: 2, source: 'weekly', value: '#1e40af' },
  { id: 'weekly.mixed.color', slot: 'color', bands: AB, rarity: 2, source: 'weekly', value: '#c026d3' },
  { id: 'weekly.bridgeHundred.theme', slot: 'theme', bands: C, rarity: 2, source: 'weekly', value: '#fb923c' },
  { id: 'weekly.tables.theme', slot: 'theme', bands: C, rarity: 2, source: 'weekly', value: '#a78bfa' },
  { id: 'weekly.bigNumbers.theme', slot: 'theme', bands: C, rarity: 2, source: 'weekly', value: '#f472b6' },
  { id: 'weekly.numberLine.theme', slot: 'theme', bands: C, rarity: 2, source: 'weekly', value: '#a3e635' },
  { id: 'weekly.belowZero.theme', slot: 'theme', bands: C, rarity: 2, source: 'weekly', value: '#38bdf8' },
  { id: 'weekly.mixed.theme', slot: 'theme', bands: C, rarity: 2, source: 'weekly', value: '#e879f9' },
  // ── slot: target ──
  // ── slot: dice ──
  // ── slot: puzzle ──
  // ── slot: workshop ──
  // ── slot: balance ──
  // ── slot: coord ──
  // ── slot: season ──
  // Seasonal cosmetics (src/core/seasons.ts): drop only in their season, kept for good once earned.
  ...SEASON_COSMETICS,
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
