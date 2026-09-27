/**
 * SessionEngine: the only object game modes talk to.
 *
 *   const s = new SessionEngine(ctx, learner, config)
 *   const p = s.next()                 // PresentedItem (or null when the session is over)
 *   const r = s.answer(p, response, …) // grading, rating + memory update, unlocks, log record
 *
 * It is pure with respect to storage: it returns updated learner state and
 * log records; the app layer persists them. That keeps it deterministic
 * (seeded) and unit/simulation testable.
 */
import type { NumberConventions } from '../../i18n/numbers';
import { gradeResponse, type GradeResult, type Response } from '../items/grade';
import { getGenerator } from '../items/generators/registry';
import type { Capability, GeneratedItem, GeneratorDef, Item } from '../items/types';
import { clamp01 } from '../items/util';
import type { InputMethod, ItemRecord } from '../log/types';
import { key as ratKey } from '../rational';
import { createRng, type Rng } from '../rng';
import type { SkillGraph } from '../skills/graph';
import type { SkillDef } from '../skills/types';
import type { BandId, LocaleId, ModeId, SkillId } from '../types';
import { difficultyToLevel, levelToDifficulty } from './glicko';
import type { LearnerModel, SkillState, SkillStatus } from './model';
import { applyFirstAttempt } from './observe';
import { modeEvidence, SELECTION } from './params';
import {
  nextPlacementItem,
  placementMemory,
  placementPriors,
  posteriorStats,
  updatePlacement,
  type PlacementState,
} from './placement';
import { chooseSkill, compatibleBindings, isUnlocked, type Eligibility, type ItemSource } from './scheduler';

export interface EngineContext {
  graph: SkillGraph;
  model: LearnerModel;
  now: () => number;
}

export interface LearnerSnapshot {
  skills: Record<SkillId, SkillState>;
  placement: { done: boolean; state: PlacementState | null; g?: number; sd?: number };
}

export interface SessionConfig {
  sessionId: string;
  seed: number;
  /** reviewFloor: skills below this grade are never offered as review/maintenance (presentation policy). */
  band: { id: BandId; targetP: number; allowReading: boolean; maxReturns: number; reviewFloor?: number };
  mode: { id: ModeId; requires: readonly Capability[]; filter?: Eligibility['filter'] };
  /** First presentations before the session winds down (retries still flush). */
  plannedItems: number;
  stretch: boolean;
  timed: boolean;
  /** Serve only these skills (round-robin), skipping scheduling and placement. Test hook (SessionOptions.only). */
  only?: readonly SkillId[];
}

export interface PresentedItem {
  item: Item;
  attempt: number;
  source: ItemSource;
  predictedP: number;
  difficulty: number;
  mu: number;
  s2: number;
  shownAt: number;
}

export interface AnswerInput {
  response: Response;
  latencyMs: number;
  hint: boolean;
  locale: LocaleId;
  conv: NumberConventions;
  input: InputMethod;
}

export interface AnswerResult {
  grade: GradeResult;
  presented: PresentedItem;
  /** Present only when an attempt was counted (not for invalid input). */
  record: ItemRecord | null;
  statusChange: { skillId: SkillId; from: SkillStatus; to: SkillStatus } | null;
  unlocked: SkillId[];
  willReturn: boolean;
  placementFinished: { g: number; sd: number } | null;
  memoryReview: { R: number; correct: boolean } | null;
}

interface RetryEntry {
  presented: PresentedItem;
  dueAt: number;
}

export class SessionEngine {
  private readonly rng: Rng;
  private states: Record<SkillId, SkillState>;
  private placement: LearnerSnapshot['placement'];
  private readonly history: SkillId[] = [];
  private readonly retries: RetryEntry[] = [];
  private firstPresented = 0;
  private answered = 0;
  private firstCorrect = 0;
  private newIntroduced = 0;
  private ewma: number;
  private itemCounter = 0;

  constructor(
    private readonly ctx: EngineContext,
    learner: LearnerSnapshot,
    private readonly cfg: SessionConfig,
  ) {
    this.rng = createRng(cfg.seed);
    this.states = { ...learner.skills };
    this.placement = { ...learner.placement };
    this.ewma = cfg.band.targetP;
  }

  get snapshot(): LearnerSnapshot {
    return { skills: this.states, placement: this.placement };
  }

  get stats(): { firstPresented: number; answered: number; firstCorrect: number; pendingRetries: number } {
    return {
      firstPresented: this.firstPresented,
      answered: this.answered,
      firstCorrect: this.firstCorrect,
      pendingRetries: this.retries.length,
    };
  }

  get planned(): number {
    return this.cfg.plannedItems;
  }

  /** Placement items will be served (not done, and this session was given the placement state). */
  get placementRunning(): boolean {
    return !this.placement.done && !!this.placement.state;
  }

  private eligibility(): Eligibility {
    return {
      requires: this.cfg.mode.requires,
      allowReading: this.cfg.band.allowReading,
      reviewFloor: this.cfg.band.reviewFloor ?? 0,
      ...(this.cfg.mode.filter ? { filter: this.cfg.mode.filter } : {}),
    };
  }

  isComplete(): boolean {
    return this.firstPresented >= this.cfg.plannedItems && this.retries.length === 0;
  }

  /** Target success probability after the closed-loop correction. */
  targetP(): number {
    const base = this.cfg.band.targetP - (this.cfg.stretch ? SELECTION.STRETCH_DELTA : 0);
    const p = base + SELECTION.CONTROLLER_GAIN * (base - this.ewma);
    return Math.min(SELECTION.P_MAX, Math.max(SELECTION.P_MIN, p));
  }

  private stateFor(skill: SkillDef, now: number): SkillState {
    let st = this.states[skill.id];
    if (!st) {
      st = this.ctx.model.init(skill, now);
      this.states = { ...this.states, [skill.id]: st };
    }
    return st;
  }

  private generate(skill: SkillDef, level: number): Item {
    const bindings = compatibleBindings(skill, this.eligibility());
    const binding = bindings[this.rng.weighted(bindings.map((b) => b.weight ?? 1))]!;
    const gen = getGenerator(binding.id);
    const { seed, rng } = this.rng.fork();
    const g = gen.generate(clamp01(level), rng, binding.config ?? {});
    this.itemCounter++;
    return {
      ...g,
      // Unique within the session (records also carry sid); retries share it.
      key: String(this.itemCounter),
      skillId: skill.id,
      genId: gen.id,
      genVersion: gen.version,
      seed,
    };
  }

  private present(item: Item, source: ItemSource, attempt: number): PresentedItem {
    const now = this.ctx.now();
    const skill = this.ctx.graph.get(item.skillId);
    const st = this.stateFor(skill, now);
    const difficulty = levelToDifficulty(item.level);
    return {
      item,
      attempt,
      source,
      predictedP: this.ctx.model.predict(st, difficulty, now),
      difficulty,
      mu: st.mu,
      s2: st.s2,
      shownAt: now,
    };
  }

  next(): PresentedItem | null {
    // Due retries first: the item returns a few items after the mistake.
    const dueIdx = this.retries.findIndex((r) => r.dueAt <= this.answered || this.firstPresented >= this.cfg.plannedItems);
    if (dueIdx >= 0) {
      const [entry] = this.retries.splice(dueIdx, 1);
      const p = this.present(entry!.presented.item, 'retry', entry!.presented.attempt + 1);
      this.history.push(p.item.skillId);
      return p;
    }
    if (this.firstPresented >= this.cfg.plannedItems) return null;

    const now = this.ctx.now();
    const elig = this.eligibility();
    let skill: SkillDef | null = null;
    let level = 0;
    let source: ItemSource = 'frontier';

    const forced = this.forcedSkill(elig);
    if (forced) {
      skill = forced;
      const st = this.stateFor(skill, now);
      level = difficultyToLevel(this.ctx.model.difficultyFor(st, this.targetP(), now)) + this.rng.normal() * SELECTION.JITTER;
    } else if (!this.placement.done && this.placement.state) {
      const cands = this.ctx.graph
        .playableSkills()
        .filter((s) => compatibleBindings(s, elig).length > 0 && (!elig.filter || elig.filter(s, this.states[s.id])));
      const pick = nextPlacementItem(this.placement.state, cands, this.rng);
      if (pick) {
        skill = this.ctx.graph.get(pick.skillId);
        level = pick.level;
        source = 'placement';
      }
    }

    if (!skill) {
      const choice = chooseSkill({
        graph: this.ctx.graph,
        model: this.ctx.model,
        states: this.states,
        now,
        rng: this.rng,
        eligibility: elig,
        history: this.history,
        newIntroduced: this.newIntroduced,
      });
      if (!choice) return null;
      skill = this.ctx.graph.get(choice.skillId);
      source = choice.source;
      const st = this.stateFor(skill, now);
      const d = this.ctx.model.difficultyFor(st, this.targetP(), now);
      level = difficultyToLevel(d) + this.rng.normal() * SELECTION.JITTER;
    }

    const before = this.states[skill.id];
    if (!before || before.n === 0) this.newIntroduced += source === 'placement' ? 0 : 1;
    const item = this.generate(skill, level);
    this.firstPresented++;
    this.history.push(skill.id);
    return this.present(item, source, 1);
  }

  answer(presented: PresentedItem, input: AnswerInput): AnswerResult {
    const now = this.ctx.now();
    const grade = gradeResponse(presented.item, input.response, input.conv);
    const base: AnswerResult = {
      grade,
      presented,
      record: null,
      statusChange: null,
      unlocked: [],
      willReturn: false,
      placementFinished: null,
      memoryReview: null,
    };
    if (grade.invalid) return base;

    this.answered++;
    const skill = this.ctx.graph.get(presented.item.skillId);
    const first = presented.attempt === 1;
    const correct = grade.correct;
    let statusChange: AnswerResult['statusChange'] = null;
    let unlocked: SkillId[] = [];
    let placementFinished: AnswerResult['placementFinished'] = null;
    let memoryReview: AnswerResult['memoryReview'] = null;

    if (first) {
      if (correct && !input.hint) this.firstCorrect++;
      this.ewma = (1 - SELECTION.EWMA_ALPHA) * this.ewma + SELECTION.EWMA_ALPHA * (correct ? 1 : 0);
      const unlockedBefore = this.unlockedSet();
      this.stateFor(skill, now);

      // Memory event + ability update + status (shared with log replay).
      const effect = applyFirstAttempt(this.ctx, this.states, skill.id, {
        correct,
        hint: input.hint,
        difficulty: presented.difficulty,
        ts: now,
        timed: this.cfg.timed,
        weight: modeEvidence(this.cfg.mode.id),
      });
      this.states = effect.states;
      statusChange = effect.statusChange;
      memoryReview = effect.memoryReview;

      // Placement posterior; finishing it rewrites priors for every skill.
      if (presented.source === 'placement' && this.placement.state) {
        const ps = updatePlacement(this.placement.state, skill, presented.item.level, correct && !input.hint);
        this.placement = { ...this.placement, state: ps };
        if (ps.done) placementFinished = this.finishPlacement(now);
      }

      const unlockedAfter = this.unlockedSet();
      unlocked = [...unlockedAfter].filter((s) => !unlockedBefore.has(s));
    }

    // Wrong ⇒ worked feedback now, and the item comes back a few items later.
    const willReturn = !correct && presented.attempt <= this.cfg.band.maxReturns;
    if (willReturn) this.retries.push({ presented, dueAt: this.answered + SELECTION.RETRY_GAP });

    const record: ItemRecord = {
      type: 'item',
      ts: now,
      sid: this.cfg.sessionId,
      key: presented.item.key,
      skill: skill.id,
      gen: presented.item.genId,
      genV: presented.item.genVersion,
      seed: presented.item.seed,
      level: round3(presented.item.level),
      diff: round3(presented.difficulty),
      p: round3(presented.predictedP),
      mu: round3(presented.mu),
      s2: round3(presented.s2),
      correct,
      attempt: presented.attempt,
      latency: Math.round(input.latencyMs),
      hint: input.hint,
      answer: grade.given,
      expected: ratKey(presented.item.answer.value),
      mis: grade.misconception,
      mode: this.cfg.mode.id,
      band: this.cfg.band.id,
      locale: input.locale,
      source: presented.source,
      timed: this.cfg.timed,
      input: input.input,
      hops: input.response.kind === 'landed' ? input.response.hops ?? null : input.response.kind === 'hops' ? input.response.count : null,
      alt: grade.altReading,
    };
    return { ...base, record, statusChange, unlocked, willReturn, placementFinished, memoryReview };
  }

  /** With `only`, the next forced skill this mode can serve (round-robin); null otherwise. */
  private forcedSkill(elig: Eligibility): SkillDef | null {
    const ids = (this.cfg.only ?? []).filter((id) => this.ctx.graph.has(id) && compatibleBindings(this.ctx.graph.get(id), elig).length > 0);
    return ids.length ? this.ctx.graph.get(ids[this.firstPresented % ids.length]!) : null;
  }

  private unlockedSet(): Set<SkillId> {
    const out = new Set<SkillId>();
    for (const s of this.ctx.graph.playableSkills()) if (isUnlocked(this.ctx.graph, s.id, this.states)) out.add(s.id);
    return out;
  }

  /** Turn the placement posterior into priors for every playable skill not yet practised. */
  private finishPlacement(now: number): { g: number; sd: number } {
    const ps = this.placement.state!;
    const { mean, sd } = posteriorStats(ps);
    const priors = placementPriors(ps, this.ctx.graph);
    const next: Record<SkillId, SkillState> = { ...this.states };
    for (const [id, prior] of priors) {
      const existing = next[id];
      const skill = this.ctx.graph.get(id);
      let st = this.ctx.model.init(skill, now, { ...prior, origin: 'placement' });
      if (existing && existing.n > 0) {
        // Keep observed counts; combine the placement prior with what was seen.
        st = { ...existing, mu: (existing.mu + prior.mu) / 2, s2: Math.min(existing.s2, prior.s2) };
      }
      const status = this.ctx.model.status(st, skill, true, now);
      st = { ...st, status };
      if (status === 'proficient' || status === 'mastered') st = placementMemory(st, skill, mean, now);
      next[id] = st;
    }
    // Status of skills now depends on unlocks; recompute once.
    for (const id of Object.keys(next)) {
      const skill = this.ctx.graph.get(id);
      next[id] = { ...next[id]!, status: this.ctx.model.status(next[id], skill, isUnlocked(this.ctx.graph, id, next), now) };
    }
    this.states = next;
    this.placement = { done: true, state: null, g: round3(mean), sd: round3(sd) };
    return { g: mean, sd };
  }

  /**
   * Present an item the MODE chose (e.g. a Dice Race move built from the dice
   * with the generator's `fromOperands`) instead of one the scheduler picked.
   * It is predicted, graded, rated and logged exactly like any first attempt,
   * with source 'fixed'. The skill must be one the generator is bound to, so
   * the level means what the rating model expects.
   */
  presentFixed(skillId: SkillId, generated: GeneratedItem, gen: Pick<GeneratorDef, 'id' | 'version'>, seed: number): PresentedItem {
    const skill = this.ctx.graph.get(skillId);
    this.itemCounter++;
    const item: Item = { ...generated, key: String(this.itemCounter), skillId: skill.id, genId: gen.id, genVersion: gen.version, seed };
    const before = this.states[skill.id];
    if (!before || before.n === 0) this.newIntroduced++;
    this.firstPresented++;
    this.history.push(skill.id);
    return this.present(item, 'fixed', 1);
  }
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
