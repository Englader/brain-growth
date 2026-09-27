/** Process-wide singletons. */
import { Speaker } from '../audio/speech';
import { isEnabled } from '../core/flags';
import { freshSeed } from '../core/rng';
import type { SkillId } from '../core/types';
import { LocalStorageKV, MemoryKV, type KV } from '../data/kv';
import { Repo } from '../data/repo';
import { getState } from './store';

function makeKV(): KV {
  try {
    const probe = '__bg_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return new LocalStorageKV();
  } catch {
    // Private mode or storage blocked: play still works, nothing persists.
    return new MemoryKV();
  }
}

/**
 * Test-only overrides. They stay at their defaults unless the URL carries
 * `?e2e` (see applyTestParams, called from main.tsx before boot).
 */
export const testOverrides: { clockOffsetMs: number; seed: number | null; only: SkillId[] | null } = {
  clockOffsetMs: 0,
  seed: null,
  only: null,
};

/** The app clock. Everything that stores or compares time goes through this. */
export const now = (): number => Date.now() + testOverrides.clockOffsetMs;

export const repo = new Repo(makeKV(), () => now());

let seedCount = 0;
/** Seed for a new session's engine and reward rng: random, or a fixed sequence under `?e2e&seed=<n>`. */
export function nextSeed(): number {
  if (testOverrides.seed === null) return freshSeed();
  seedCount++;
  return (Math.imul(testOverrides.seed, 7919) + Math.imul(seedCount, 104_729)) | 0;
}

/** `?e2e&now=<ISO date>` shifts the clock (it keeps running); `?e2e&seed=<n>` makes sessions deterministic. */
export function applyTestParams(search: string): boolean {
  const q = new URLSearchParams(search);
  if (!q.has('e2e')) return false;
  const at = q.get('now');
  if (at) {
    const t = Date.parse(at);
    if (Number.isFinite(t)) testOverrides.clockOffsetMs = t - Date.now();
  }
  const seed = q.get('seed');
  if (seed !== null && Number.isFinite(Number(seed))) testOverrides.seed = Number(seed) | 0;
  return true;
}

export function flag(id: string): boolean {
  const s = getState();
  return isEnabled(id, s.profile?.flags, s.meta?.deviceFlags);
}

export const speaker = new Speaker(() => flag('audio.tts') && (getState().profile?.settings.voice ?? true));
