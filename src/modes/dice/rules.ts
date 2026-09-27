/**
 * Dice Race integration rules (no UI): which operators a child is offered,
 * and how a move's operands become a REAL item for that child's own engine.
 *
 * The pure race rules live in src/core/dice. A move there carries a skill
 * hint (`as.add.20`, `md.mult.facts`, `int.addsub`…). Band A hints can point
 * at a skill the child has not unlocked yet (a 5-year-old rolls 5 from pad 8).
 * Rating that item under a locked skill would seed it with a single noisy
 * observation, so the item is rated under the NEAREST UNLOCKED skill of the
 * same kind (same generator, same operator), and, when none is unlocked, the
 * most basic one. The level always comes from that skill's own generator
 * scorer (`fromOperands`), so a hard sum rated under "within 10" simply reads
 * as a hard item for that skill.
 */
import { isUnlocked } from '../../core/engine/scheduler';
import type { SkillState } from '../../core/engine/model';
import { diceOpsFor, type DiceItemSpec, type DiceOp } from '../../core/dice';
import { getGenerator } from '../../core/items/generators/registry';
import type { GeneratedItem, GeneratorDef, Operands } from '../../core/items/types';
import { GRAPH } from '../../core/skills';
import type { SkillGraph } from '../../core/skills/graph';
import type { SkillDef } from '../../core/skills/types';
import type { SkillId } from '../../core/types';

/** A move's item, ready for `SessionEngine.presentFixed`. */
export interface MoveItem {
  skillId: SkillId;
  generated: GeneratedItem;
  gen: GeneratorDef;
}

/** Band B operators for a child: + always; − and × once their skills are unlocked. */
export function opsForSkills(states: Record<SkillId, SkillState>, graph: SkillGraph = GRAPH): DiceOp[] {
  return diceOpsFor((skill) => graph.has(skill) && isUnlocked(graph, skill, states));
}

const operandsOf = (spec: DiceItemSpec): Operands => ({ a: spec.a, op: spec.op, b: spec.b });

/** The first binding of `skill` whose generator can build these operands, with its item. */
function express(skill: SkillDef, o: Operands): { gen: GeneratorDef; family: string; generated: GeneratedItem } | null {
  for (const b of skill.gens ?? []) {
    const gen = getGenerator(b.id);
    const generated = gen.fromOperands?.(o, b.config ?? {}) ?? null;
    if (generated) return { gen, family: `${b.id}|${String((b.config as { op?: unknown } | undefined)?.op ?? '')}`, generated };
  }
  return null;
}

/**
 * The skill a move is rated under, for this child: the hint when it is
 * unlocked; else the unlocked skill of the same kind nearest in curriculum
 * grade (ties: the lower one); else the most basic skill of that kind.
 */
export function moveSkill(spec: DiceItemSpec, states: Record<SkillId, SkillState>, graph: SkillGraph = GRAPH): SkillId {
  const o = operandsOf(spec);
  const hint = graph.get(spec.skillHint);
  const own = express(hint, o);
  if (!own) throw new Error(`dice: ${spec.skillHint} cannot express ${spec.a} ${spec.op} ${spec.b}`);
  if (isUnlocked(graph, hint.id, states)) return hint.id;
  const kin = graph
    .playableSkills()
    .filter((s) => express(s, o)?.family === own.family)
    .sort((x, y) => x.grade - y.grade);
  const unlocked = kin.filter((s) => isUnlocked(graph, s.id, states));
  if (unlocked.length) {
    const dist = (s: SkillDef): number => Math.abs(s.grade - hint.grade);
    return unlocked.reduce((best, s) => (dist(s) < dist(best) ? s : best)).id;
  }
  return kin[0]?.id ?? hint.id;
}

/** The real item for a move: rated skill, its generator, and the item built from the move's operands. */
export function moveItem(spec: DiceItemSpec, states: Record<SkillId, SkillState>, graph: SkillGraph = GRAPH): MoveItem {
  const skillId = moveSkill(spec, states, graph);
  const built = express(graph.get(skillId), operandsOf(spec));
  if (!built) throw new Error(`dice: ${skillId} cannot express ${spec.a} ${spec.op} ${spec.b}`);
  return { skillId, generated: built.generated, gen: built.gen };
}
