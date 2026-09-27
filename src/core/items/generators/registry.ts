/**
 * Generator registry. Adding a generator = write a GeneratorDef, list it in
 * BUILTIN (or, for a feature mode's own generators, in ON_DEMAND) in
 * ./index.ts. Skills bind to generators by id in the catalog; nothing else
 * changes.
 *
 * On-demand generators (DESIGN §3.2, "Size"): a feature mode's generators
 * (and the solvers behind them) stay out of the start-up bundle. Their ids
 * and capabilities are declared up front, because the skill graph and the
 * scheduler read them at start-up (what is playable, what a mode can serve);
 * the implementation module loads with the mode (`loadGeneratorsFor`, called
 * by modes/lazy.tsx before the mode's play screen asks for an item). The
 * engine generates synchronously, so a declared generator whose module is not
 * in yet throws if asked to generate. Tests, the simulation and scripts load
 * everything first (`loadAllGenerators`).
 */
import type { Capability, GeneratorDef } from '../types';

/** A generator known by id and capabilities before its implementation module is loaded. */
export interface GeneratorDecl {
  id: string;
  capabilities: readonly Capability[];
}

/** One module's on-demand generators: what they are, and how to fetch their definitions. */
export interface OnDemandGenerators {
  declared: readonly GeneratorDecl[];
  load: () => Promise<readonly GeneratorDef<any>[]>;
}

const registry = new Map<string, GeneratorDef<any>>();
/** Declared but not yet loaded: id → the module that brings it. */
const onDemand = new Map<string, { group: OnDemandGenerators; pending: Promise<void> | null }>();

const sameCaps = (a: readonly Capability[], b: readonly Capability[]): boolean =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function registerGenerator(def: GeneratorDef<any>): void {
  const waiting = onDemand.get(def.id);
  if (registry.has(def.id) && !waiting) throw new Error(`generator ${def.id} registered twice`);
  if (waiting) {
    const decl = waiting.group.declared.find((d) => d.id === def.id)!;
    if (!sameCaps(decl.capabilities, def.capabilities)) throw new Error(`generator ${def.id}: capabilities differ from its declaration`);
    onDemand.delete(def.id);
  }
  registry.set(def.id, def);
}

function notLoaded(decl: GeneratorDecl): GeneratorDef<any> {
  return {
    id: decl.id,
    version: 0,
    capabilities: decl.capabilities,
    generate() {
      throw new Error(`generator ${decl.id} is not loaded yet: loadGeneratorsFor(mode.requires) before the session serves items`);
    },
  };
}

/** Declare a module's generators now; their implementations load on demand. */
export function declareGenerators(group: OnDemandGenerators): void {
  for (const d of group.declared) {
    if (onDemand.has(d.id)) throw new Error(`generator ${d.id} declared twice`);
    if (registry.has(d.id)) continue; // already loaded (e.g. by a test that imported the module)
    onDemand.set(d.id, { group, pending: null });
    registry.set(d.id, notLoaded(d));
  }
}

export function getGenerator(id: string): GeneratorDef<any> {
  const g = registry.get(id);
  if (!g) throw new Error(`unknown generator ${id}`);
  return g;
}

/** Registered or declared (the skill graph counts both as playable). */
export function hasGenerator(id: string): boolean {
  return registry.has(id);
}

export function generatorLoaded(id: string): boolean {
  return registry.has(id) && !onDemand.has(id);
}

export function allGenerators(): GeneratorDef<any>[] {
  return [...registry.values()];
}

function loadIds(ids: Iterable<string>): Promise<void> {
  const groups = new Set<{ group: OnDemandGenerators; pending: Promise<void> | null }>();
  for (const id of ids) {
    const w = onDemand.get(id);
    if (w) groups.add(w);
  }
  return Promise.all(
    [...groups].map((w) => {
      w.pending ??= w.group.load().then(
        (defs) => {
          for (const def of defs) {
            // Every on-demand generator is declared up front: the skill graph must not change once the app runs.
            if (!w.group.declared.some((d) => d.id === def.id)) throw new Error(`generator ${def.id} is loaded on demand but was not declared`);
            if (onDemand.has(def.id)) registerGenerator(def);
          }
          const missing = w.group.declared.filter((d) => !generatorLoaded(d.id));
          if (missing.length) throw new Error(`generators ${missing.map((d) => d.id).join(', ')} were declared but their module did not provide them`);
        },
        (e: unknown) => {
          w.pending = null; // a failed fetch may be retried
          throw e;
        },
      );
      return w.pending;
    }),
  ).then(() => undefined);
}

/** The generators a session requiring `requires` may use (capabilities ⊇ requires). */
const usableBy = (requires: readonly Capability[]): string[] =>
  [...registry.values()].filter((g) => requires.every((c) => g.capabilities.includes(c))).map((g) => g.id);

/** Whether every generator a mode requiring `requires` could serve is loaded. */
export function generatorsReadyFor(requires: readonly Capability[]): boolean {
  return usableBy(requires).every(generatorLoaded);
}

/** Load every generator a mode requiring `requires` could serve. Resolves at once when they are in. */
export function loadGeneratorsFor(requires: readonly Capability[]): Promise<void> {
  return loadIds(usableBy(requires));
}

/** Load every declared generator (tests, the simulation, scripts). */
export function loadAllGenerators(): Promise<void> {
  return loadIds([...onDemand.keys()]);
}
