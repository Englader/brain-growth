import type { SkillId } from '../types';
import type { SkillDef } from './types';

/**
 * Read-only view over the skill DAG with the queries the engine needs.
 *
 * Unlock semantics use EFFECTIVE prerequisites: the nearest *playable*
 * ancestors. A node that has no generator yet can never gate a child —
 * unbuilt content must not become a wall.
 */
export class SkillGraph {
  private readonly byId = new Map<SkillId, SkillDef>();
  private readonly childrenOf = new Map<SkillId, SkillDef[]>();
  private readonly effCache = new Map<SkillId, SkillId[]>();

  constructor(
    readonly skills: readonly SkillDef[],
    private readonly playable: (s: SkillDef) => boolean,
  ) {
    for (const s of skills) this.byId.set(s.id, s);
    for (const s of skills) {
      for (const p of s.prereqs) {
        const list = this.childrenOf.get(p) ?? [];
        list.push(s);
        this.childrenOf.set(p, list);
      }
    }
  }

  get(id: SkillId): SkillDef {
    const s = this.byId.get(id);
    if (!s) throw new Error(`unknown skill ${id}`);
    return s;
  }

  has(id: SkillId): boolean {
    return this.byId.has(id);
  }

  isPlayable(id: SkillId): boolean {
    const s = this.byId.get(id);
    return !!s && this.playable(s);
  }

  playableSkills(): SkillDef[] {
    return this.skills.filter((s) => this.playable(s));
  }

  children(id: SkillId): SkillDef[] {
    return this.childrenOf.get(id) ?? [];
  }

  /** Nearest playable ancestors along each prerequisite path. */
  effectivePrereqs(id: SkillId): SkillId[] {
    const cached = this.effCache.get(id);
    if (cached) return cached;
    const out = new Set<SkillId>();
    for (const p of this.get(id).prereqs) {
      if (this.isPlayable(p)) out.add(p);
      else for (const q of this.effectivePrereqs(p)) out.add(q);
    }
    const result = [...out];
    this.effCache.set(id, result);
    return result;
  }

  ancestors(id: SkillId): Set<SkillId> {
    const out = new Set<SkillId>();
    const stack = [...this.get(id).prereqs];
    while (stack.length) {
      const p = stack.pop()!;
      if (out.has(p)) continue;
      out.add(p);
      stack.push(...this.get(p).prereqs);
    }
    return out;
  }

  /** Kahn topological order, ties broken by grade then id (stable docs & UI). */
  topo(): SkillDef[] {
    const indeg = new Map<SkillId, number>();
    for (const s of this.skills) indeg.set(s.id, s.prereqs.length);
    const ready = this.skills.filter((s) => s.prereqs.length === 0);
    const out: SkillDef[] = [];
    const byOrder = (a: SkillDef, b: SkillDef): number => a.grade - b.grade || a.id.localeCompare(b.id);
    ready.sort(byOrder);
    while (ready.length) {
      const s = ready.shift()!;
      out.push(s);
      for (const c of this.children(s.id)) {
        const d = (indeg.get(c.id) ?? 0) - 1;
        indeg.set(c.id, d);
        if (d === 0) {
          ready.push(c);
          ready.sort(byOrder);
        }
      }
    }
    return out;
  }

  /** Structural validation; returns human-readable problems (empty = valid). */
  validate(bandGradeRanges: Record<string, [number, number]>): string[] {
    const errors: string[] = [];
    const seen = new Set<SkillId>();
    for (const s of this.skills) {
      if (seen.has(s.id)) errors.push(`duplicate id ${s.id}`);
      seen.add(s.id);
      for (const p of s.prereqs) {
        const ps = this.byId.get(p);
        if (!ps) errors.push(`${s.id}: unknown prereq ${p}`);
        else if (ps.grade > s.grade) errors.push(`${s.id} (grade ${s.grade}) depends on later ${p} (grade ${ps.grade})`);
      }
      const range = bandGradeRanges[s.band];
      if (!range) errors.push(`${s.id}: unknown band ${s.band}`);
      else if (s.grade < range[0] || s.grade >= range[1]) {
        errors.push(`${s.id}: grade ${s.grade} outside band ${s.band} [${range[0]}, ${range[1]})`);
      }
    }
    if (this.topo().length !== this.skills.length) errors.push('cycle detected');
    return errors;
  }
}
