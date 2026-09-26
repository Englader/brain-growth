/**
 * Schema migrations. The rule that matters: a data-model change must never
 * cost a child their streak.
 *
 *  - Migrations are ordered functions over a KV, so the SAME code upgrades
 *    live localStorage and an old backup file loaded into a MemoryKV.
 *  - Before migrating, every `bg:` key is snapshotted (to a backup key if it
 *    fits, always in memory); any exception restores the snapshot exactly and
 *    the app runs read-only rather than corrupting data.
 *  - Data from a NEWER schema (an old cached app build after an update) is
 *    opened read-only; nothing is written until the new build loads.
 */
import { uid } from '../core/hash';
import { KEYS, CURRENT_SCHEMA, type Meta } from './schema';
import { readJSON, type KV } from './kv';

export interface Migration {
  /** Schema version this migration produces (from = to − 1). */
  to: number;
  description: string;
  up(kv: KV, now: number): void;
}

/**
 * Registered migrations. Empty in schema v1. Example of the next one:
 *
 *   { to: 2, description: 'profile.settings.voice → settings.audio.voice',
 *     up(kv) { for (const k of kv.keys(KEYS.profilePrefix)) { … } } }
 */
export const MIGRATIONS: Migration[] = [];

export interface MigrationReport {
  from: number | null;
  to: number;
  ran: string[];
  readOnly: boolean;
  error: string | null;
  freshInstall: boolean;
}

export function freshMeta(now: number, schema = CURRENT_SCHEMA): Meta {
  return {
    schema,
    deviceId: uid('d'),
    profileIds: [],
    activeProfileId: null,
    createdAt: now,
    lastBackupAt: null,
    deviceFlags: {},
    adultSeen: false,
  };
}

function snapshot(kv: KV): Map<string, string> {
  const snap = new Map<string, string>();
  for (const k of kv.keys()) {
    if (k.startsWith(KEYS.backupPrefix)) continue;
    snap.set(k, kv.get(k)!);
  }
  return snap;
}

function restore(kv: KV, snap: Map<string, string>): void {
  for (const k of kv.keys()) if (!k.startsWith(KEYS.backupPrefix) && !snap.has(k)) kv.remove(k);
  for (const [k, v] of snap) kv.set(k, v);
}

export function runMigrations(
  kv: KV,
  now: number,
  migrations: readonly Migration[] = MIGRATIONS,
  target = CURRENT_SCHEMA,
): MigrationReport {
  const meta = readJSON<Meta>(kv, KEYS.meta);
  if (!meta) {
    kv.set(KEYS.meta, JSON.stringify(freshMeta(now, target)));
    return { from: null, to: target, ran: [], readOnly: false, error: null, freshInstall: true };
  }
  const from = meta.schema;
  if (from === target) return { from, to: target, ran: [], readOnly: false, error: null, freshInstall: false };
  if (from > target) {
    return { from, to: target, ran: [], readOnly: true, error: `data schema ${from} is newer than app schema ${target}`, freshInstall: false };
  }

  const snap = snapshot(kv);
  try {
    kv.set(KEYS.backup(from), JSON.stringify(Object.fromEntries(snap)));
  } catch {
    // Not enough room for an on-disk copy; the in-memory snapshot still guards this run.
  }
  const ran: string[] = [];
  try {
    const steps = [...migrations].filter((m) => m.to > from && m.to <= target).sort((a, b) => a.to - b.to);
    let version = from;
    for (const m of steps) {
      if (m.to !== version + 1) throw new Error(`missing migration to v${version + 1}`);
      m.up(kv, now);
      version = m.to;
      const cur = readJSON<Meta>(kv, KEYS.meta)!;
      kv.set(KEYS.meta, JSON.stringify({ ...cur, schema: version }));
      ran.push(`v${m.to}: ${m.description}`);
    }
    if (version !== target) throw new Error(`no migration path from v${from} to v${target}`);
    return { from, to: target, ran, readOnly: false, error: null, freshInstall: false };
  } catch (e) {
    restore(kv, snap);
    return { from, to: target, ran, readOnly: true, error: e instanceof Error ? e.message : String(e), freshInstall: false };
  }
}
