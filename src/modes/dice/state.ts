/**
 * The Dice Race match store: local to this mode, never part of the app store
 * (whose `profile` and `session` stay the active child's). It holds the pure
 * race state (src/core/dice, plain JSON), one engine session per player, and
 * where the current turn is. The JSON part is mirrored to sessionStorage so a
 * reload in the middle of a race resumes it (fresh sessions, same board and
 * dice); it is dropped when the race ends. Nothing here is progress: every
 * answer is recorded on its own child's profile the moment it is given.
 */
import { useEffect, useState } from 'preact/hooks';
import type { ActiveSession, SessionResult } from '../../app/store';
import type { DiceNote, MatchState, MoveResult } from '../../core/dice';
import type { AnswerResult, PresentedItem } from '../../core/engine/session';
import { toNumber } from '../../core/rational';

export type DicePhase = 'pass' | 'turn' | 'results';

export interface TurnState {
  /** Unique per turn (keys the turn screen, so each turn starts fresh). */
  id: number;
  /** Index of the player acting (the match's `turn` moves on as soon as the move is made). */
  player: number;
  /** Option chosen: 0 for A and C once rolled, the operator for B; null before. */
  choice: number | null;
  /** The real item for the chosen move, presented on the player's own engine. */
  presented: PresentedItem | null;
  /** The graded answer and the move it made (the move never depends on the answer). */
  answered: { res: AnswerResult; move: MoveResult; from: number } | null;
}

export interface PlayerResult {
  pid: string;
  arrived: boolean;
  line: DiceNote;
  /** Problems this child answered in the race (across a reload, which starts fresh sessions). */
  items: number;
  result: SessionResult;
}

export interface DiceState {
  match: MatchState | null;
  sessions: Record<string, ActiveSession>;
  phase: DicePhase;
  turn: TurnState;
  results: PlayerResult[] | null;
  /** The players of the last race, in turn order ("race again"). */
  lastPids: string[];
  /** Per child: problems answered in sessions from before a reload (resumed races only). */
  carried: Record<string, number>;
}

let turnSeq = 0;
export const freshTurn = (player: number): TurnState => ({ id: ++turnSeq, player, choice: null, presented: null, answered: null });

let state: DiceState = { match: null, sessions: {}, phase: 'pass', turn: freshTurn(0), results: null, lastPids: [], carried: {} };
const listeners = new Set<(s: DiceState) => void>();

export function getDice(): DiceState {
  return state;
}

export function setDice(patch: Partial<DiceState>): void {
  state = { ...state, ...patch };
  if ('match' in patch || 'sessions' in patch) persist(state);
  for (const l of listeners) l(state);
}

/** Re-render on every match-store change. */
export function useDice(): DiceState {
  const [s, set] = useState(state);
  useEffect(() => {
    listeners.add(set);
    set(state);
    return () => {
      listeners.delete(set);
    };
  }, []);
  return s;
}

// ── reload survival (sessionStorage: this tab only, gone when it closes) ────
const KEY = 'hopa.dice.match';

export interface SavedMatch {
  v: 1;
  match: MatchState;
  /** Problems each child has answered so far in this race. */
  items: Record<string, number>;
}

function persist(s: DiceState): void {
  try {
    const match = s.match;
    if (!match || match.over) {
      sessionStorage.removeItem(KEY);
      return;
    }
    const items = Object.fromEntries(match.players.map((p) => [p.id, (s.carried[p.id] ?? 0) + (s.sessions[p.id]?.firstAttempts ?? 0)]));
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, match, items } satisfies SavedMatch));
  } catch {
    // Storage blocked: a reload just ends the race.
  }
}

export function savedMatch(): SavedMatch | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as SavedMatch) : null;
    return saved?.v === 1 && saved.match && !saved.match.over ? { ...saved, items: saved.items ?? {} } : null;
  } catch {
    return null;
  }
}

// ── e2e: a read-only snapshot on window.__hopa.dice() (only when the ?e2e hooks exist) ──
export function exposeForTests(): void {
  const hooks = (globalThis as { __hopa?: Record<string, unknown> }).__hopa;
  if (!hooks || hooks.dice) return;
  hooks.dice = () => {
    const s = state;
    const p = s.turn.presented;
    return {
      phase: s.phase,
      match: s.match,
      turn: {
        player: s.turn.player,
        choice: s.turn.choice,
        item: p ? { skill: p.item.skillId, source: p.source, answer: toNumber(p.item.answer.value) } : null,
        answered: s.turn.answered ? { correct: s.turn.answered.res.grade.correct, target: s.turn.answered.move.lane.position } : null,
      },
      results: s.results?.map((r) => ({ pid: r.pid, arrived: r.arrived, items: r.items })) ?? null,
    };
  };
}
