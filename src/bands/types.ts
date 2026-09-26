/**
 * A band is a CONFIG, not a code path. The engine reads the first block
 * (targets, reading, session length); the presentation layer reads the rest.
 * Screens that must differ structurally (home, results) look up a component
 * variant by band id in their own registries; everything else is theming.
 */
import type { BandId } from '../core/types';

export interface BandConfig {
  id: BandId;
  /** Ages that default to this band at profile creation (overridable). */
  ages: readonly [number, number];

  // ── engine-facing ──
  /** Target first-attempt success rate for item selection. */
  targetP: number;
  /** Items that need reading (word problems) are allowed. */
  allowReading: boolean;
  /** How many times a wrong item may come back in one session. */
  maxReturns: number;
  /** First presentations per normal session. */
  sessionItems: number;
  /** Items in the "quick spark" minimum daily session (< 60 s). */
  quickItems: number;
  /** Target minutes per day: normalises effort in the family league. */
  targetMinutes: number;
  /** Timed (opt-in) modes may be offered at all. Never in Band A. */
  timersAllowed: boolean;

  // ── presentation ──
  theme: 'meadow' | 'lagoon' | 'slate';
  input: 'hops' | 'numpad';
  /** visual: animation only, no text. short: animation + one line. worked: full worked steps. */
  feedback: 'visual' | 'short' | 'worked';
  /** always: every prompt is spoken. onTap: speaker button. off: silent by default. */
  audio: 'always' | 'onTap' | 'off';
  companion: 'pet' | 'none';
  hopper: 'frog' | 'marker';
  /** Reveal-style for rewards. */
  rewards: 'gifts' | 'unlocks';
  /** Show accuracy numbers to the child (Band C only; never framed as a reward). */
  showStats: boolean;
}
