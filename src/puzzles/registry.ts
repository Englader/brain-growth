/**
 * Puzzle-type registry. Adding a type = write a PuzzleTypeDef and list it in
 * `src/puzzles/index.ts` (or call registerPuzzleType from a plugin module).
 * The shelf shows `puzzleTypesFor(band)` in registration order.
 */
import type { BandId } from '../core/types';
import type { AnyPuzzleType, PuzzleTypeId } from './types';

const registry = new Map<PuzzleTypeId, AnyPuzzleType>();

export function registerPuzzleType(def: AnyPuzzleType): void {
  if (registry.has(def.id)) throw new Error(`puzzle type ${def.id} registered twice`);
  if (def.bands.length === 0) throw new Error(`puzzle type ${def.id} has no bands`);
  registry.set(def.id, def);
}

export function getPuzzleType(id: PuzzleTypeId): AnyPuzzleType {
  const def = registry.get(id);
  if (!def) throw new Error(`unknown puzzle type ${id}`);
  return def;
}

export function hasPuzzleType(id: PuzzleTypeId): boolean {
  return registry.has(id);
}

export function allPuzzleTypes(): AnyPuzzleType[] {
  return [...registry.values()];
}

/** Types offered in a band, in registration (shelf) order. */
export function puzzleTypesFor(band: BandId): AnyPuzzleType[] {
  return allPuzzleTypes().filter((d) => d.bands.includes(band));
}
