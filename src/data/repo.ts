/**
 * Repository: the only module that knows storage keys and formats.
 * Synchronous (localStorage), crash-safe per write, quota-aware.
 */
import { decodeRecord, encodeRecord, recordIdentity } from '../core/log/codec';
import type { AnyRecord, LogRecord } from '../core/log/types';
import { mergeRivals, type RivalCard } from '../core/league';
import { normalizeProfile, type Profile } from '../core/profile';
import { monthKey } from '../core/time';
import { hashHex } from '../core/hash';
import { compactIfNeeded, type Rollup } from './compaction';
import { readJSON, StorageFullError, type KV, MemoryKV } from './kv';
import { mergeProfiles } from './merge';
import { freshMeta, runMigrations, type MigrationReport } from './migrations';
import { CURRENT_SCHEMA, KEYS, type LogChunk, type Meta } from './schema';

export const APP_VERSION = '0.1.0';

export interface BackupFile {
  format: 'brain-growth-backup';
  formatVersion: 1;
  schema: number;
  app: string;
  exportedAt: number;
  entries: Record<string, string>;
  checksum: string;
}

export interface ImportReport {
  ok: boolean;
  error?: string;
  profilesAdded: string[];
  profilesMerged: string[];
  recordsAdded: number;
}

export class Repo {
  readOnly = false;
  storageFull = false;
  migration: MigrationReport | null = null;

  constructor(
    readonly kv: KV,
    private readonly now: () => number = Date.now,
  ) {}

  init(): MigrationReport {
    const report = runMigrations(this.kv, this.now());
    this.readOnly = report.readOnly;
    this.migration = report;
    return report;
  }

  // ── writes go through here: quota errors trigger compaction, then retry ──
  private write(key: string, value: string): void {
    if (this.readOnly) return;
    try {
      this.kv.set(key, value);
    } catch (e) {
      if (!(e instanceof StorageFullError)) throw e;
      compactIfNeeded(this.kv, monthKey(this.now()), true);
      try {
        this.kv.set(key, value);
        this.storageFull = false;
      } catch (e2) {
        this.storageFull = true;
        throw e2;
      }
    }
  }

  meta(): Meta {
    return readJSON<Meta>(this.kv, KEYS.meta) ?? freshMeta(this.now());
  }

  saveMeta(patch: Partial<Meta>): Meta {
    const next = { ...this.meta(), ...patch };
    this.write(KEYS.meta, JSON.stringify(next));
    return next;
  }

  // ── profiles ──
  listProfiles(): Profile[] {
    return this.meta()
      .profileIds.map((id) => this.loadProfile(id))
      .filter((p): p is Profile => p !== null);
  }

  loadProfile(id: string): Profile | null {
    const raw = readJSON<Profile>(this.kv, KEYS.profile(id));
    return raw ? normalizeProfile(raw) : null;
  }

  saveProfile(p: Profile): Profile {
    const next = { ...p, updatedAt: this.now() };
    this.write(KEYS.profile(p.id), JSON.stringify(next));
    const meta = this.meta();
    if (!meta.profileIds.includes(p.id)) this.saveMeta({ profileIds: [...meta.profileIds, p.id] });
    return next;
  }

  deleteProfile(id: string): void {
    for (const k of [...this.kv.keys(KEYS.logPrefix(id)), ...this.kv.keys(KEYS.rollupPrefix(id)), KEYS.profile(id)]) this.kv.remove(k);
    const meta = this.meta();
    this.saveMeta({
      profileIds: meta.profileIds.filter((x) => x !== id),
      activeProfileId: meta.activeProfileId === id ? null : meta.activeProfileId,
    });
  }

  // ── session log ──
  appendLog(pid: string, records: readonly LogRecord[]): void {
    const byMonth = new Map<string, unknown[]>();
    for (const r of records) {
      const m = monthKey(r.ts);
      const list = byMonth.get(m) ?? [];
      list.push(encodeRecord(r));
      byMonth.set(m, list);
    }
    for (const [month, encoded] of byMonth) {
      const key = KEYS.log(pid, month);
      // Re-read immediately before writing: minimises lost appends if two tabs are open.
      const chunk = readJSON<LogChunk>(this.kv, key) ?? { v: 1, r: [] };
      chunk.r.push(...encoded);
      this.write(key, JSON.stringify(chunk));
    }
  }

  logMonths(pid: string): string[] {
    return this.kv.keys(KEYS.logPrefix(pid)).map((k) => k.slice(KEYS.logPrefix(pid).length));
  }

  readLog(pid: string, sinceTs = 0): AnyRecord[] {
    const sinceMonth = monthKey(sinceTs || 0);
    const out: AnyRecord[] = [];
    for (const month of this.logMonths(pid)) {
      if (sinceTs && month < sinceMonth) continue;
      const chunk = readJSON<LogChunk>(this.kv, KEYS.log(pid, month));
      if (!chunk) continue;
      for (const raw of chunk.r) {
        const r = decodeRecord(raw);
        if (r.ts >= sinceTs) out.push(r);
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  /** Decoded known records only (callers that do not care about unknown future types). */
  readKnownLog(pid: string, sinceTs = 0): LogRecord[] {
    return this.readLog(pid, sinceTs).filter((r): r is LogRecord => r.type !== 'unknown');
  }

  readRollups(pid: string): Rollup[] {
    return this.kv
      .keys(KEYS.rollupPrefix(pid))
      .map((k) => readJSON<Rollup>(this.kv, k))
      .filter((r): r is Rollup => r !== null);
  }

  // ── rivals ──
  rivals(): Record<string, RivalCard> {
    return readJSON<Record<string, RivalCard>>(this.kv, KEYS.rivals) ?? {};
  }

  saveRival(card: RivalCard): void {
    this.write(KEYS.rivals, JSON.stringify(mergeRivals(this.rivals(), { [card.pid]: card })));
  }

  removeRival(pid: string): void {
    const r = this.rivals();
    delete r[pid];
    this.write(KEYS.rivals, JSON.stringify(r));
  }

  // ── storage health ──
  usage(): { bytes: number; byProfile: Record<string, number> } {
    const byProfile: Record<string, number> = {};
    for (const k of this.kv.keys()) {
      const m = /^bg:(?:profile|log|rollup):([^:]+)/.exec(k);
      if (m) byProfile[m[1]!] = (byProfile[m[1]!] ?? 0) + 2 * (k.length + (this.kv.get(k)?.length ?? 0));
    }
    return { bytes: this.kv.bytesUsed(), byProfile };
  }

  maintain(): string[] {
    if (this.readOnly) return [];
    return compactIfNeeded(this.kv, monthKey(this.now()));
  }

  // ── backup ──
  exportBackup(profileIds?: string[]): BackupFile {
    const meta = this.meta();
    const ids = new Set(profileIds ?? meta.profileIds);
    const entries: Record<string, string> = {};
    for (const k of this.kv.keys()) {
      if (k.startsWith(KEYS.backupPrefix)) continue;
      const m = /^bg:(?:profile|log|rollup):([^:]+)/.exec(k);
      if (m && !ids.has(m[1]!)) continue;
      entries[k] = this.kv.get(k)!;
    }
    entries[KEYS.meta] = JSON.stringify({ ...meta, profileIds: meta.profileIds.filter((id) => ids.has(id)) });
    const body = JSON.stringify(entries);
    this.saveMeta({ lastBackupAt: this.now() });
    return {
      format: 'brain-growth-backup',
      formatVersion: 1,
      schema: CURRENT_SCHEMA,
      app: APP_VERSION,
      exportedAt: this.now(),
      entries,
      checksum: hashHex(body),
    };
  }

  importBackup(text: string): ImportReport {
    const report: ImportReport = { ok: false, profilesAdded: [], profilesMerged: [], recordsAdded: 0 };
    let file: BackupFile;
    try {
      file = JSON.parse(text) as BackupFile;
    } catch {
      return { ...report, error: 'not-json' };
    }
    if (file?.format !== 'brain-growth-backup' || file.formatVersion !== 1 || typeof file.entries !== 'object') {
      return { ...report, error: 'not-a-backup' };
    }
    if (hashHex(JSON.stringify(file.entries)) !== file.checksum) return { ...report, error: 'checksum' };
    if (this.readOnly) return { ...report, error: 'read-only' };

    // Bring the backup up to the current schema with the same migrations as live data.
    const mem = new MemoryKV();
    for (const [k, v] of Object.entries(file.entries)) mem.set(k, v);
    const mig = runMigrations(mem, this.now());
    if (mig.error) return { ...report, error: `migration: ${mig.error}` };
    const incoming = new Repo(mem, this.now);

    for (const p of incoming.listProfiles()) {
      const existing = this.loadProfile(p.id);
      if (existing) {
        this.write(KEYS.profile(p.id), JSON.stringify(mergeProfiles(existing, p)));
        report.profilesMerged.push(p.id);
      } else {
        this.write(KEYS.profile(p.id), JSON.stringify(p));
        const meta = this.meta();
        this.saveMeta({ profileIds: [...meta.profileIds, p.id] });
        report.profilesAdded.push(p.id);
      }
      // Logs: union of records by identity, per month.
      for (const month of incoming.logMonths(p.id)) {
        const key = KEYS.log(p.id, month);
        const theirs = readJSON<LogChunk>(mem, key)?.r ?? [];
        const ours = readJSON<LogChunk>(this.kv, key) ?? { v: 1 as const, r: [] };
        const seen = new Set(ours.r.map(recordIdentity));
        const add = theirs.filter((r) => !seen.has(recordIdentity(r)));
        if (add.length) {
          const merged = [...ours.r, ...add].sort((x, y) => decodeRecord(x).ts - decodeRecord(y).ts);
          this.write(key, JSON.stringify({ v: 1, r: merged }));
          report.recordsAdded += add.length;
        }
      }
      for (const k of mem.keys(KEYS.rollupPrefix(p.id))) if (!this.kv.get(k)) this.write(k, mem.get(k)!);
    }
    const theirRivals = readJSON<Record<string, RivalCard>>(mem, KEYS.rivals);
    if (theirRivals) this.write(KEYS.rivals, JSON.stringify(mergeRivals(this.rivals(), theirRivals)));
    return { ...report, ok: true };
  }
}
