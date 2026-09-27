/**
 * Surprise drops: a variable-ratio schedule on PARTICIPATION.
 *
 * After every answered first attempt — right or wrong — a gift appears with
 * hazard p = min(0.35, base + ramp · itemsSinceLastDrop). The rising hazard
 * bounds the dry spells (no child waits 60 items), the variability keeps it
 * a surprise, and because correctness is not an input the drop can never be
 * read as payment for getting answers right. Gifts are revealed on the
 * session summary, decoupled from any individual answer.
 *
 * Expected spacing: ~9 items in Band A (≈1 per session), ~12 in B/C.
 */
import type { Rng } from '../rng';
import { inSeasonDrop } from '../seasons';
import type { BandId } from '../types';
import { COSMETICS, type CosmeticDef } from './cosmetics';

export interface DropParams {
  base: number;
  ramp: number;
  max: number;
}

export const DROP_PARAMS: Record<BandId, DropParams> = {
  A: { base: 0.03, ramp: 0.02, max: 0.4 },
  B: { base: 0.02, ramp: 0.012, max: 0.35 },
  C: { base: 0.02, ramp: 0.012, max: 0.35 },
};

export function dropProbability(itemsSinceDrop: number, band: BandId): number {
  const p = DROP_PARAMS[band];
  return Math.min(p.max, p.base + p.ramp * itemsSinceDrop);
}

const RARITY_WEIGHT = { 1: 6, 2: 3, 3: 1 } as const;

/**
 * In season, seasonal cosmetics weigh this much more than their rarity says,
 * so a child who plays during the season is likely to meet one (about a
 * third of drops for Bands A/B). Only which item drops changes, never how
 * often a gift appears.
 */
export const SEASON_DROP_BOOST = 3;

/**
 * Is `c` in the drop pool on `date`? Ordinary cosmetics always are; seasonal
 * ones only while their season is active (src/core/seasons.ts), and never
 * without a date (seasonal touches switched off); weekly set pieces never.
 */
export function inDropPool(c: CosmeticDef, date?: number | string): boolean {
  const source = c.source ?? 'drop';
  if (source === 'drop') return true;
  return source === 'season' && date !== undefined && inSeasonDrop(c, date);
}

/**
 * Weighted pick of an unowned cosmetic for the band (null when the collection
 * is complete). Only the drop pool: weekly set pieces have their own source
 * and never drop at random; seasonal items join only in season, when the
 * caller passes the date (`date` omitted: no seasonal items).
 */
export function pickCosmetic(owned: readonly string[], band: BandId, rng: Rng, date?: number | string): CosmeticDef | null {
  const pool = COSMETICS.filter((c) => inDropPool(c, date) && c.bands.includes(band) && !owned.includes(c.id));
  if (!pool.length) return null;
  return pool[rng.weighted(pool.map((c) => RARITY_WEIGHT[c.rarity] * (c.source === 'season' ? SEASON_DROP_BOOST : 1)))]!;
}

export interface DropRoll {
  itemsSinceDrop: number;
  dropped: CosmeticDef | null;
}

/** One participation tick. `date` lets in-season seasonal cosmetics into the pool (see pickCosmetic). */
export function rollDrop(itemsSinceDrop: number, owned: readonly string[], band: BandId, rng: Rng, date?: number | string): DropRoll {
  const next = itemsSinceDrop + 1;
  if (!rng.chance(dropProbability(itemsSinceDrop, band))) return { itemsSinceDrop: next, dropped: null };
  const c = pickCosmetic(owned, band, rng, date);
  return { itemsSinceDrop: c ? 0 : next, dropped: c };
}
