/**
 * Items are LOCALE-AGNOSTIC structured data. Nothing in here is display text:
 * rendering (numbers, operator glyphs, sentences) happens in the presentation
 * layer with the active locale, which is why a child can flip EN⇄MK in the
 * middle of an item and see the same problem re-rendered instantly.
 */
import type { Rational } from '../rational';
import type { Rng } from '../rng';
import type { SkillId } from '../types';

export type Op = '+' | '-' | '*' | '/';

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'op'; op: Op; a: Expr; b: Expr }
  | { k: 'blank' };

export type Prompt =
  /** "a op b = ?" or, with rhs, "a + ? = rhs". */
  | { kind: 'expr'; expr: Expr; rhs?: Expr }
  /** Dots to count (dice pattern, ten-frame, or scattered). */
  | { kind: 'count'; count: number; layout: 'dice' | 'frame' | 'scatter' }
  /** "Hop to 34." */
  | { kind: 'locate'; target: number }
  /** Base-ten blocks: land on the number they show. */
  | { kind: 'blocks'; hundreds: number; tens: number; ones: number }
  /** "3 hops of 4": equal groups on the number line. */
  | { kind: 'groups'; groups: number; size: number }
  /** Word problem rendered from a per-locale template with shared structure. */
  | { kind: 'word'; templateId: string; vars: Record<string, number>; nameSeed: number };

/** Number-line geometry. All slice skills are number-line capable. */
export interface LineSpec {
  min: number;
  max: number;
  /** Where the hopper starts. */
  start: number;
  major: number;
  minor: number;
  labelEvery: number;
  /** Hop-button sizes for button input (Band A): [1], [10, 1], [5]… */
  steps: number[];
  /** A flag on the line (missing addend, "how many hops to reach"). */
  flag?: number;
  /**
   * land:  the answer is where the hopper lands.
   * count: the answer is how many hops of `hopSize` it takes to reach `flag`.
   */
  answerMode: 'land' | 'count';
  hopSize?: number;
}

export interface Answer {
  value: Rational;
  /** Absolute tolerance for estimation items (number-line placement). */
  tolerance?: number;
}

export type SolutionStep =
  /** A hop the feedback animation performs, in order. */
  | { k: 'hop'; from: number; to: number }
  /** A worked-step sentence (Bands B/C). Key is resolved in the locale bundle. */
  | { k: 'say'; key: string; params: Record<string, number | string> };

export interface GeneratedItem {
  /** Achieved difficulty on the generator's [0,1] scale (may differ from requested). */
  level: number;
  prompt: Prompt;
  answer: Answer;
  line: LineSpec;
  solution: SolutionStep[];
  /** Predicted wrong answers with the misconception each one signals. */
  misconceptions: Array<{ value: number; code: string }>;
  /** Raw difficulty features — logged so difficulty can be re-fit from data later. */
  features: Record<string, number>;
}

/** A generated item bound to its provenance; this is what the log records. */
export interface Item extends GeneratedItem {
  /** Unique id of this presentation (retries of the same item share it). */
  key: string;
  skillId: SkillId;
  genId: string;
  genVersion: number;
  seed: number;
}

export type Capability = 'numberLine' | 'numeric' | 'reading';

export interface GeneratorDef<C = Record<string, unknown>> {
  id: string;
  /** Bump when output for a given (seed, level, config) changes. Logged per item. */
  version: number;
  capabilities: readonly Capability[];
  generate(level: number, rng: Rng, config: C): GeneratedItem;
}
