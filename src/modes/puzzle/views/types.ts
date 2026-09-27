/**
 * The contract between the puzzle frame (PuzzlePlay) and one view per puzzle
 * type. The frame owns checking, hints, reveal and scoring; a view owns its
 * board, its editable state S, and how S maps to the core's answer A.
 */
import type { ComponentType } from 'preact';
import type { BandId, LocaleId } from '../../../core/types';
import type { Translator } from '../../../i18n/i18n';

export interface BoardProps<P, S, A> {
  puzzle: P;
  state: S;
  /** Functional update, so fast key presses compose (never a stale render value). */
  update: (f: (s: S) => S) => void;
  /** Ids to highlight: violated constraints of the last check and the current hint's focus. */
  marks: ReadonlySet<string>;
  /** Solved or revealed: the board is read-only. */
  locked: boolean;
  band: BandId;
  locale: LocaleId;
  t: Translator;
  /** Check now; views that check on tap (Band A) pass the state they just set. */
  check: (s?: S) => void;
  /** Band A errorless step: the correct answer glows so the child can tap it. */
  glow: A | null;
}

export interface ViewDef<P, A, S> {
  init(p: P, band: BandId): S;
  /** The answer to check (may be partial: the checker names what is missing). */
  answer(p: P, s: S): A;
  /** Board state showing a given answer (reveal). */
  fromAnswer(p: P, a: A, band: BandId): S;
  /** Whether the Check button is enabled. */
  canCheck(p: P, s: S): boolean;
  /** The view checks on tap and has no Check button (Band A pictures). */
  tapToCheck?: (p: P, band: BandId) => boolean;
  Board: ComponentType<BoardProps<P, S, A>>;
}

/** Edit a typed number string with a pad key ('0'–'9', 'back', 'neg'). */
export function editNumber(v: string, key: string, maxDigits = 6): string {
  if (key === 'back') return v.slice(0, -1);
  if (key === 'neg') return v.startsWith('−') ? v.slice(1) : `−${v}`;
  if (!/^\d$/.test(key)) return v;
  const digits = v.replace('−', '');
  if (digits.length >= maxDigits) return v;
  return digits === '0' ? `${v.startsWith('−') ? '−' : ''}${key}` : v + key;
}

/** Parse a typed integer ('−' or '-' for negative); NaN when empty or incomplete. */
export function parseTyped(v: string): number {
  const m = /^[−-]?\d+$/.exec(v.trim());
  return m ? Number(v.trim().replace('−', '-')) : Number.NaN;
}
