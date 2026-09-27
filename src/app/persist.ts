/**
 * Persistence helpers shared by every action module (actions.ts and feature
 * modules such as src/app/<feature>Actions.ts). Each takes the profile it
 * works on explicitly, so a pass-and-play mode can write to a child who is
 * not the active profile. Nothing here navigates.
 */
import { ACHIEVEMENTS, evaluateAchievements, type EvalContext, type Trigger } from '../core/achievements';
import type { EventRecord, LogRecord } from '../core/log/types';
import { EVENTS } from '../core/log/types';
import type { Profile } from '../core/profile';
import { questProgress } from '../core/quests';
import { GRAPH } from '../core/skills';
import { dayKey } from '../core/time';
import { StorageFullError } from '../data/kv';
import { modesFor } from '../modes/registry';
import { now, repo } from './services';
import { getState, setState } from './store';

const DAY = 86_400_000;
const LOG_WINDOW_DAYS = 120;

// ── recent-log cache (write-through) ───────────────────────────────────────
const logCache = new Map<string, LogRecord[]>();

/** The last 120 days of a child's log (cached; appendLog keeps it current). */
export function recentLog(pid: string): LogRecord[] {
  let l = logCache.get(pid);
  if (!l) {
    l = repo.readKnownLog(pid, now() - LOG_WINDOW_DAYS * DAY);
    logCache.set(pid, l);
  }
  return l;
}

/** Drop cached logs (one profile, or all after a backup import). */
export function forgetLog(pid?: string): void {
  if (pid) logCache.delete(pid);
  else logCache.clear();
}

export function appendLog(pid: string, records: LogRecord[]): void {
  if (!records.length) return;
  // Load the cache BEFORE writing: loading after would read these records back and then push them twice.
  const cached = recentLog(pid);
  try {
    repo.appendLog(pid, records);
  } catch (e) {
    if (e instanceof StorageFullError) setState({ storageFull: true });
    else throw e;
  }
  cached.push(...records);
}

export function event(name: string, data: Record<string, unknown> | null, sid: string | null): EventRecord {
  return { type: 'event', ts: now(), sid, name, data };
}

/** Persist a profile and refresh it in the store (as the active profile only if it is the active one). */
export function saveProfile(p: Profile): Profile {
  let saved = p;
  try {
    saved = repo.saveProfile(p);
  } catch (e) {
    if (e instanceof StorageFullError) setState({ storageFull: true });
    else throw e;
  }
  setState((s) => ({
    profile: s.profile?.id === saved.id || !s.profile ? saved : s.profile,
    profiles: s.profiles.some((x) => x.id === saved.id) ? s.profiles.map((x) => (x.id === saved.id ? saved : x)) : [...s.profiles, saved],
  }));
  return saved;
}

// ── evaluation context ─────────────────────────────────────────────────────
export function evalCtx(p: Profile, sessionId: string | null): EvalContext {
  const t = now();
  return {
    profile: p,
    now: t,
    today: dayKey(t),
    log: recentLog(p.id),
    sessionId,
    graph: GRAPH,
    modesAvailable: modesFor(p, getState().meta?.deviceFlags ?? {}).length,
    memo: new Map(),
  };
}

/** Evaluate achievements for `trigger`, log each unlock, and return the updated (unsaved) profile. */
export function unlockAchievements(p: Profile, trigger: Trigger, sid: string | null): { profile: Profile; ids: string[] } {
  const ids = evaluateAchievements(ACHIEVEMENTS, evalCtx(p, sid), trigger);
  if (!ids.length) return { profile: p, ids };
  const t = now();
  const achievements = { ...p.achievements };
  for (const id of ids) achievements[id] = { at: t, seen: false };
  appendLog(p.id, ids.map((id) => event(EVENTS.ACHIEVEMENT, { id }, sid)));
  return { profile: { ...p, achievements }, ids };
}

export function questsOn(p: Profile): boolean {
  const flags = getState().meta?.deviceFlags ?? {};
  return p.flags['quests.daily'] ?? flags['quests.daily'] ?? true;
}

/** Mark today's quests that are now complete (returns the updated, unsaved profile). */
export function updateQuests(p: Profile, sid: string | null): Profile {
  if (!p.quests || p.quests.day !== dayKey(now()) || !questsOn(p)) return p;
  const ctx = evalCtx(p, sid);
  const done = p.quests.ids.filter((id) => questProgress(id, ctx).done);
  return done.length === p.quests.done.length ? p : { ...p, quests: { ...p.quests, done } };
}
