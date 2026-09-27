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
  /** A fraction n/d, drawn stacked. `n: null` is a blank numerator ("2/3 = ?/12"). Never reduced for display. */
  | { k: 'frac'; n: number | null; d: number }
  | { k: 'op'; op: Op; a: Expr; b: Expr }
  | { k: 'blank' };

export type Prompt =
  /** "a op b = ?" or, with rhs, "a + ? = rhs". */
  | { kind: 'expr'; expr: Expr; rhs?: Expr }
  /** Dots to count (dice pattern, ten-frame, or scattered). */
  | { kind: 'count'; count: number; layout: 'dice' | 'frame' | 'scatter' }
  /** "Hop to 34." `display` writes the target another way (a stacked fraction 3/4, a decimal). */
  | { kind: 'locate'; target: number; display?: Expr }
  /** "Land on the bigger (or smaller) one": the answer is the position of that number. */
  | { kind: 'compare'; a: Expr; b: Expr; pick: 'max' | 'min' }
  /** A flag stands on the line (`line.flag`): type the number it marks. */
  | { kind: 'read'; value: number }
  /** "25 % of 80": typed answer; the line is a double number line (quantities and percents). */
  | { kind: 'percentOf'; pct: number; of: number }
  /** Base-ten blocks: land on the number they show. */
  | { kind: 'blocks'; hundreds: number; tens: number; ones: number }
  /** "3 hops of 4": equal groups on the number line. */
  | { kind: 'groups'; groups: number; size: number }
  /** Word problem rendered from a per-locale template with shared structure. */
  | { kind: 'word'; templateId: string; vars: Record<string, number>; nameSeed: number }
  /**
   * A mode-specific prompt (e.g. a Target deal). `type` names a definition in
   * the custom-prompt registry (./customPrompts.ts), which renders its text and
   * spoken line and validates it in tests; `data` is its locale-agnostic payload.
   */
  | CustomPrompt;

export interface CustomPrompt {
  kind: 'custom';
  type: string;
  data: Record<string, unknown>;
}

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
  /**
   * Rational line: ticks, pads, hops and picks sit at k/den for integer k, and a
   * landing grades as exactly rat(round(v·den), den). Every other length of the
   * line (min, max, major, minor, labelEvery, steps, hopSize) is a multiple of 1/den.
   */
  den?: number;
  /** How positions are written on this line: stacked fractions k/den, decimals, or percents of max (a double line). */
  labelStyle?: 'fraction' | 'decimal' | 'percent';
  /** The answer is a point tapped on the line (snapped to 1/den), not typed. */
  pick?: 'tap';
}

export interface Answer {
  /** The canonical answer (logged as `expected`; the value a checker's correct response should represent). */
  value: Rational;
  /** Absolute tolerance for estimation items (number-line placement). */
  tolerance?: number;
  /**
   * Grade with a registered checker instead of comparing to `value` (items with
   * many correct answers: an expression, a construction). See ./checkers.ts.
   */
  check?: { id: string; params?: Record<string, number> };
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
  /** Id of this presentation, unique within its session (retries of the same item share it). */
  key: string;
  skillId: SkillId;
  genId: string;
  genVersion: number;
  seed: number;
}

/** What a generator's items need from a mode. One member per line; features add theirs under their slot. */
export type Capability =
  | 'numberLine'
  | 'numeric'
  | 'reading'
  // ── slot: frac ──
  // ── slot: hint ──
  // ── slot: pilot ──
  // ── slot: storage ──
  // ── slot: weekly ──
  // ── slot: target ──
  | 'deal'
  // ── slot: dice ──
  // ── slot: puzzle ──
  // ── slot: workshop ──
  // ── slot: balance ──
  /** A construction graded by a checker (Balance scale, coordinate plane, Workshop): modes that build, not hop. */
  | 'build'
  // ── slot: coord ──
  // ── slot: season ──
  ;

export interface GeneratorDef<C = Record<string, unknown>> {
  id: string;
  /** Bump when output for a given (seed, level, config) changes. Logged per item. */
  version: number;
  capabilities: readonly Capability[];
  generate(level: number, rng: Rng, config: C): GeneratedItem;
}
