/** Process-wide singletons. */
import { Speaker } from '../audio/speech';
import { isEnabled } from '../core/flags';
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

export const repo = new Repo(makeKV());

export const now = (): number => Date.now();

export function flag(id: string): boolean {
  const s = getState();
  return isEnabled(id, s.profile?.flags, s.meta?.deviceFlags);
}

export const speaker = new Speaker(() => flag('audio.tts') && (getState().profile?.settings.voice ?? true));
