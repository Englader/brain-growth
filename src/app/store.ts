/**
 * Minimal global store: one immutable state object, shallow-merged updates,
 * subscribers. Enough for a handful of screens without a state library.
 */
import { useEffect, useState } from 'preact/hooks';
import type { SessionEngine, PresentedItem } from '../core/engine/session';
import type { RivalCard } from '../core/league';
import type { SessionOptions } from '../core/log/types';
import type { MessageParams } from '../i18n/format';
import type { Profile, SprintRun } from '../core/profile';
import type { Rng } from '../core/rng';
import type { LocaleId, ModeId, SkillId } from '../core/types';
import type { Meta } from '../data/schema';

export interface ActiveSession {
  id: string;
  /** The child this session belongs to (pass-and-play modes hold several). */
  pid: string;
  modeId: ModeId;
  engine: SessionEngine;
  opts: SessionOptions;
  startedAt: number;
  rng: Rng;
  current: PresentedItem | null;
  firstAttempts: number;
  firstCorrect: number;
  fixed: number;
  unlocked: SkillId[];
  mastered: SkillId[];
  gifts: string[];
  achievements: string[];
  sparkLit: boolean;
  placed: boolean;
  /** Mastery % per skill at session start (Band C summary). */
  masteryStart: Record<SkillId, number>;
  skillsSeen: SkillId[];
}

export interface SessionResult {
  modeId: ModeId;
  opts: SessionOptions;
  firstAttempts: number;
  firstCorrect: number;
  fixed: number;
  unlocked: SkillId[];
  mastered: SkillId[];
  gifts: string[];
  achievements: string[];
  sparkLit: boolean;
  placed: boolean;
  skills: Array<{ id: SkillId; before: number; after: number }>;
  sprint: { run: SprintRun; previousBest: SprintRun | null; noClock: boolean } | null;
  /** Mode-specific summary lines (message key + params), shown under the summary in Bands B/C. */
  extras?: Array<{ key: string; params?: MessageParams }>;
}

export interface AppState {
  booted: boolean;
  meta: Meta | null;
  profiles: Profile[];
  profile: Profile | null;
  route: string;
  session: ActiveSession | null;
  lastResult: SessionResult | null;
  pendingRival: RivalCard | null;
  toast: string | null;
  swUpdateReady: boolean;
  readOnly: boolean;
  storageFull: boolean;
  /** Another tab holds the single-writer lock: this one is read-only and says so. */
  otherTab: boolean;
  /** Locales whose message bundles are loaded (i18n/locales.ts); a new array each time one arrives. */
  locales: readonly LocaleId[];
  /** A language switch waiting for its bundle (the toggle shows it as busy); null when none. */
  localePending: LocaleId | null;
  /** Options of the last launchMode (year, challenge): intro screens and standalone modes start their sessions with them. */
  launchOpts: SessionOptions | null;
  /**
   * The Grown-ups area (DESIGN A-30): 'open' once the parent PIN was entered, until the route leaves
   * /adult or 5 minutes pass without use ('idle': locked by the idle timer). In memory only.
   */
  adultLock: 'locked' | 'open' | 'idle';
}

type Listener = (s: AppState) => void;

let state: AppState = {
  booted: false,
  meta: null,
  profiles: [],
  profile: null,
  route: '/',
  session: null,
  lastResult: null,
  pendingRival: null,
  toast: null,
  swUpdateReady: false,
  readOnly: false,
  storageFull: false,
  otherTab: false,
  locales: [],
  localePending: null,
  launchOpts: null,
  adultLock: 'locked',
};

const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l(state);
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Re-render when the selected slice changes (reference equality). */
export function useStore<T>(select: (s: AppState) => T): T {
  const [value, setValue] = useState(() => select(state));
  useEffect(() => {
    const update = (s: AppState): void => {
      const next = select(s);
      setValue((prev) => (Object.is(prev, next) ? prev : next));
    };
    const unsub = subscribe(update);
    // The store may have changed between the first render and this subscription
    // (e.g. a redirect issued while rendering a stale /play/… URL after a reload).
    update(state);
    return () => {
      unsub();
    };
    // `select` is expected to be stable in intent; re-subscribing each render is wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}
