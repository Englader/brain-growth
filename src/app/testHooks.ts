/**
 * End-to-end test hooks, installed as `window.__hopa` only when the URL has
 * `?e2e` (main.tsx). They drive the same production paths the UI uses:
 * seeding creates a real profile and rebuilds its skills through the log
 * replay the adult dashboard uses; forcing a skill only narrows which skills
 * a session serves. Companion URL params (services.applyTestParams):
 * `?seed=<n>` deterministic sessions, `?now=<ISO>` shifted clock.
 */
import type { LogRecord } from '../core/log/types';
import { EVENTS } from '../core/log/types';
import { defaultBandForAge } from '../core/profile';
import { getCosmetic, starterCosmetics } from '../core/rewards/cosmetics';
import { GRAPH } from '../core/skills';
import type { BandId, SkillId } from '../core/types';
import { addProfile, rebuildFromLog, updateProfile } from './actions';
import { appendLog, event, recentLog } from './persist';
import { testOverrides } from './services';
import { getState, type AppState } from './store';

export interface SeedInput {
  name: string;
  age: number;
  locale?: string;
  /** Band override (default: from age). */
  band?: BandId;
  /** Placement result (grade position, e.g. 5.5). Omit to leave placement pending (first session places). */
  g?: number;
  sd?: number;
  /** Per-child flag overrides, e.g. { 'mode.sprint': false }. */
  flags?: Record<string, boolean>;
  /** Cosmetic ids waiting as unopened gifts (rewards.pending), opened through the real wardrobe/results path. */
  gifts?: string[];
}

export interface HopaTestHooks {
  getState(): AppState;
  /** The last 120 days of a child's log (default: the active child). */
  recentLog(pid?: string): LogRecord[];
  /**
   * Create a child, make it active (home screen), and optionally place it at
   * grade `g`: a synthetic placement_done event is logged and skills are
   * rebuilt by replay. Returns the profile id.
   */
  seed(input: SeedInput): string;
  /** Every session started from now on serves only these skills (null clears). Throws on an unplayable id. */
  forceSkill(ids: SkillId | SkillId[] | null): void;
}

function seed(input: SeedInput): string {
  const band = input.band ?? defaultBandForAge(input.age);
  const avatar = starterCosmetics(band, band === 'C' ? 'theme' : 'color')[0]?.id ?? 'color.green';
  const p = addProfile({ name: input.name, age: input.age, locale: input.locale ?? 'mk', avatar, band });
  if (input.flags) updateProfile(p.id, { flags: { ...input.flags } });
  if (input.gifts) {
    for (const id of input.gifts) if (!getCosmetic(id)) throw new Error(`seed: unknown cosmetic ${id}`);
    updateProfile(p.id, { rewards: { ...p.rewards, pending: [...input.gifts] } });
  }
  if (input.g !== undefined) {
    const g = input.g;
    const sd = input.sd ?? 0.3;
    appendLog(p.id, [event(EVENTS.PLACEMENT_DONE, { g, sd }, null)]);
    updateProfile(p.id, { placement: { done: true, state: null, g, sd } });
    rebuildFromLog(p.id);
  }
  return p.id;
}

function forceSkill(ids: SkillId | SkillId[] | null): void {
  const list = ids === null ? null : Array.isArray(ids) ? ids : [ids];
  for (const id of list ?? []) if (!GRAPH.isPlayable(id)) throw new Error(`forceSkill: ${id} is not a playable skill`);
  testOverrides.only = list;
}

export function installTestHooks(): void {
  const hooks: HopaTestHooks = {
    getState,
    recentLog: (pid) => recentLog(pid ?? getState().profile?.id ?? ''),
    seed,
    forceSkill,
  };
  (window as unknown as { __hopa: HopaTestHooks }).__hopa = hooks;
}
