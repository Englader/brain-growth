/**
 * Generator registry. Adding a generator = write a GeneratorDef, list it in
 * BUILTIN below (or call registerGenerator from a plugin module). Skills bind
 * to generators by id in the catalog; nothing else changes.
 */
import type { GeneratorDef } from '../types';

const registry = new Map<string, GeneratorDef<any>>();

export function registerGenerator(def: GeneratorDef<any>): void {
  if (registry.has(def.id)) throw new Error(`generator ${def.id} registered twice`);
  registry.set(def.id, def);
}

export function getGenerator(id: string): GeneratorDef<any> {
  const g = registry.get(id);
  if (!g) throw new Error(`unknown generator ${id}`);
  return g;
}

export function hasGenerator(id: string): boolean {
  return registry.has(id);
}

export function allGenerators(): GeneratorDef<any>[] {
  return [...registry.values()];
}
