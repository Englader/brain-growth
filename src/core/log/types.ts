/**
 * Session log record shapes (in-memory, latest version). The on-disk form is
 * a versioned positional encoding (log/codec.ts). The log is append-only and
 * over-records on purpose: it is the substrate for calibration, misconception
 * analysis, model swaps (replay), and everything in the adult dashboard.
 */
import type { ItemSource } from '../engine/scheduler';
import type { BandId, LocaleId, ModeId, SkillId } from '../types';

export type InputMethod = 'typed' | 'tap' | 'hops' | 'choice';

export interface ItemRecord {
  type: 'item';
  ts: number;
  sid: string;
  /** Item presentation id, unique within the session; retries share it. */
  key: string;
  skill: SkillId;
  gen: string;
  genV: number;
  seed: number;
  /** Achieved generator level and its logit difficulty. */
  level: number;
  diff: number;
  /** Model prediction and belief BEFORE this response (calibration analysis). */
  p: number;
  mu: number;
  s2: number;
  correct: boolean;
  attempt: number;
  latency: number;
  hint: boolean;
  /** Canonical given answer and expected answer (rational keys). */
  answer: string;
  expected: string;
  /** Misconception code matched by a wrong answer. */
  mis: string | null;
  mode: ModeId;
  band: BandId;
  locale: LocaleId;
  source: ItemSource;
  timed: boolean;
  input: InputMethod;
  /** Hop-button presses used (strategy signal: counting vs direct tap). */
  hops: number | null;
  /** Correct only under the other locale's separator reading. */
  alt: boolean;
}

export interface SessionOptions {
  stretch?: boolean;
  timed?: boolean;
  noClock?: boolean;
  quick?: boolean;
  /** Serve only these skills, bypassing scheduling and placement (e2e `__hopa.forceSkill`; never set by the UI). */
  only?: SkillId[];
}

export interface SessionRecord {
  type: 'session';
  ts: number;
  sid: string;
  phase: 'start' | 'end';
  mode: ModeId;
  band: BandId;
  locale: LocaleId;
  opts: SessionOptions;
  /** End-only summary fields. */
  items: number | null;
  firstCorrect: number | null;
  durationMs: number | null;
  completed: boolean | null;
  /**
   * End-only pilot fields (DESIGN §5.2, I-1). Optional because records written
   * before them lack them; the codec decodes those as null.
   * `lastCorrect`: whether the session's last answer (any attempt) was right; null if nothing was answered.
   * `exitIndex`: for a session left early, how many items had been shown when the child quit (1 = on the first item); null when it ran to the end.
   */
  lastCorrect?: boolean | null;
  exitIndex?: number | null;
}

export interface EventRecord {
  type: 'event';
  ts: number;
  sid: string | null;
  name: string;
  data: Record<string, unknown> | null;
}

/** A record written by a newer app version that this version cannot decode; preserved verbatim. */
export interface UnknownRecord {
  type: 'unknown';
  ts: number;
  raw: unknown;
}

export type LogRecord = ItemRecord | SessionRecord | EventRecord;
export type AnyRecord = LogRecord | UnknownRecord;

/** Well-known event names (free-form names are allowed; these are what code emits). */
export const EVENTS = {
  APP_OPEN: 'app_open',
  LOCALE_SWITCH: 'locale_switch',
  STATUS_CHANGE: 'status_change',
  UNLOCK: 'unlock',
  PLACEMENT_DONE: 'placement_done',
  ACHIEVEMENT: 'achievement',
  DROP: 'drop',
  STREAK_FREEZE: 'streak_freeze',
  PET_TAP: 'pet_tap',
  QUEST_DONE: 'quest_done',
  SPRINT_RESULT: 'sprint_result',
  FLAG_CHANGE: 'flag_change',
  BAND_CHANGE: 'band_change',
  // Feature events (names `<feature>_<what>`), each under its own anchor:
  // ── slot: frac ──
  // ── slot: hint ──
  // ── slot: pilot ──
  /** Time on the feedback after a wrong answer, until the next item: `{ key, attempt, ms }` (Hop mode). */
  FEEDBACK: 'pilot_feedback',
  // ── slot: storage ──
  // ── slot: weekly ──
  // ── slot: target ──
  // ── slot: dice ──
  /** A finished (or abandoned) Dice Race, in each player's own log: facts for fairness tuning, never a winner. */
  DICE_MATCH: 'dice_match',
  // ── slot: puzzle ──
  // ── slot: workshop ──
  // ── slot: balance ──
  // ── slot: coord ──
  // ── slot: season ──
} as const;
