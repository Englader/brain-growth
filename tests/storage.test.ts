import { describe, expect, it } from 'vitest';
import { decodeRecord, encodeRecord } from '../src/core/log/codec';
import type { EventRecord, ItemRecord, SessionRecord } from '../src/core/log/types';
import { createProfile } from '../src/core/profile';
import { recordActiveDay } from '../src/core/streaks';
import { MemoryKV } from '../src/data/kv';
import { runMigrations, type Migration } from '../src/data/migrations';
import { Repo } from '../src/data/repo';
import { KEYS } from '../src/data/schema';

const T = Date.UTC(2026, 8, 15, 10);

const item = (over: Partial<ItemRecord> = {}): ItemRecord => ({
  type: 'item', ts: T, sid: 's1', key: 's1:1', skill: 'as.add.20', gen: 'addsub', genV: 1, seed: 42,
  level: 0.5, diff: 0, p: 0.84, mu: 1.2, s2: 0.4, correct: true, attempt: 1, latency: 3200, hint: false,
  answer: '13', expected: '13', mis: null, mode: 'hop', band: 'A', locale: 'mk', source: 'frontier',
  timed: false, input: 'hops', hops: 5, alt: false, tier: 0, revealed: false, ladder: null, req: 0.4870193618411321, ...over,
});

describe('log codec', () => {
  it('round-trips every record type', () => {
    const s: SessionRecord = { type: 'session', ts: T, sid: 's1', phase: 'end', mode: 'hop', band: 'B', locale: 'en', opts: { stretch: true }, items: 12, firstCorrect: 10, durationMs: 300000, completed: true, lastCorrect: true, exitIndex: null, year: 5 };
    const e: EventRecord = { type: 'event', ts: T, sid: null, name: 'pet_tap', data: { n: 3 } };
    for (const r of [item(), item({ correct: false, mis: 'add.no_carry', hops: null }), s, e]) {
      expect(decodeRecord(JSON.parse(JSON.stringify(encodeRecord(r))))).toEqual(r);
    }
  });

  it('is compact (positional)', () => {
    expect(JSON.stringify(encodeRecord(item())).length).toBeLessThan(JSON.stringify(item()).length * 0.6);
  });

  it('preserves records from a newer app version instead of dropping them', () => {
    const future = ['i', 2, T, 'whatever'];
    expect(decodeRecord(future)).toEqual({ type: 'unknown', ts: T, raw: future });
    expect(decodeRecord(['z', 1, T])).toMatchObject({ type: 'unknown' });
  });

  it('tolerates extra trailing fields appended by a newer build of the same version', () => {
    const enc = [...encodeRecord(item()), 'new-field'];
    expect(decodeRecord(enc)).toEqual(item());
  });
});

describe('migrations', () => {
  const seed = (kv: MemoryKV, schema: number): void => {
    kv.set(KEYS.meta, JSON.stringify({ schema, deviceId: 'd', profileIds: ['p1'], activeProfileId: 'p1', createdAt: T, lastBackupAt: null, deviceFlags: {}, adultSeen: false }));
    kv.set(KEYS.profile('p1'), JSON.stringify({ id: 'p1', name: 'Ана', streakDays: ['2026-09-01'] }));
  };

  it('fresh install writes meta at the current schema', () => {
    const kv = new MemoryKV();
    const r = runMigrations(kv, T);
    expect(r.freshInstall).toBe(true);
    expect(JSON.parse(kv.get(KEYS.meta)!).schema).toBe(1);
  });

  it('runs migrations in order and records the new schema', () => {
    const kv = new MemoryKV();
    seed(kv, 1);
    const calls: number[] = [];
    const migs: Migration[] = [
      { to: 3, description: 'c', up: () => calls.push(3) },
      { to: 2, description: 'b', up: (k) => { calls.push(2); const p = JSON.parse(k.get(KEYS.profile('p1'))!); k.set(KEYS.profile('p1'), JSON.stringify({ ...p, streak: { activeDays: p.streakDays } })); } },
    ];
    const r = runMigrations(kv, T, migs, 3);
    expect(calls).toEqual([2, 3]);
    expect(r.error).toBeNull();
    expect(JSON.parse(kv.get(KEYS.meta)!).schema).toBe(3);
    expect(JSON.parse(kv.get(KEYS.profile('p1'))!).streak.activeDays).toEqual(['2026-09-01']);
    expect(kv.get(KEYS.backup(1))).not.toBeNull();
  });

  it('a failing migration restores the exact previous data and goes read-only', () => {
    const kv = new MemoryKV();
    seed(kv, 1);
    const before = new Map([...kv.map].filter(([k]) => !k.startsWith(KEYS.backupPrefix)));
    const migs: Migration[] = [
      { to: 2, description: 'ok', up: (k) => k.set(KEYS.profile('p1'), '{"broken":true}') },
      { to: 3, description: 'boom', up: () => { throw new Error('boom'); } },
    ];
    const r = runMigrations(kv, T, migs, 3);
    expect(r.readOnly).toBe(true);
    expect(r.error).toBe('boom');
    const after = new Map([...kv.map].filter(([k]) => !k.startsWith(KEYS.backupPrefix)));
    expect(after).toEqual(before);
  });

  it('refuses to write data from a newer schema (old cached build after an update)', () => {
    const kv = new MemoryKV();
    seed(kv, 9);
    const r = runMigrations(kv, T, [], 1);
    expect(r.readOnly).toBe(true);
    const repo = new Repo(kv, () => T);
    repo.init();
    repo.saveProfile(createProfile({ name: 'X', age: 8, locale: 'en', avatar: 'color.green' }, T));
    expect(kv.keys(KEYS.profilePrefix)).toEqual([KEYS.profile('p1')]);
  });
});

describe('repository', () => {
  it('appends log records into month chunks and reads them back in order', () => {
    const repo = new Repo(new MemoryKV(), () => T);
    repo.init();
    const p = repo.saveProfile(createProfile({ name: 'Ана', age: 6, locale: 'mk', avatar: 'color.green' }, T));
    const aug = Date.UTC(2026, 7, 20);
    repo.appendLog(p.id, [item({ ts: T + 5 }), item({ ts: aug, key: 'k2' })]);
    repo.appendLog(p.id, [item({ ts: T + 10, key: 'k3' })]);
    expect(repo.logMonths(p.id)).toEqual(['2026-08', '2026-09']);
    expect(repo.readKnownLog(p.id).map((r) => r.ts)).toEqual([aug, T + 5, T + 10]);
    expect(repo.readKnownLog(p.id, T).length).toBe(2);
  });

  it('on quota exhaustion compacts old raw months and retries the write', () => {
    const kv = new MemoryKV(120_000);
    const repo = new Repo(kv, () => T);
    repo.init();
    const p = repo.saveProfile(createProfile({ name: 'B', age: 9, locale: 'en', avatar: 'color.green' }, T));
    const old = Date.UTC(2026, 0, 10);
    const bulk = Array.from({ length: 200 }, (_, i) => item({ ts: old + i * 1000, key: `o${i}` }));
    repo.appendLog(p.id, bulk);
    const fresh = Array.from({ length: 200 }, (_, i) => item({ ts: T + i * 1000, key: `n${i}` }));
    repo.appendLog(p.id, fresh);
    expect(kv.get(KEYS.log(p.id, '2026-01'))).toBeNull();
    expect(kv.get(KEYS.rollup(p.id, '2026-01'))).not.toBeNull();
    expect(repo.readKnownLog(p.id).length).toBe(200);
    const roll = repo.readRollups(p.id)[0]!;
    expect(roll.days['2026-01-10']!['as.add.20']!.first).toBe(200);
  });
});

describe('backup export/import', () => {
  function seeded(): { repo: Repo; pid: string } {
    const repo = new Repo(new MemoryKV(), () => T);
    repo.init();
    let p = createProfile({ name: 'Марко', age: 9, locale: 'mk', avatar: 'color.green' }, T);
    p = { ...p, streak: ['2026-09-10', '2026-09-11', '2026-09-12'].reduce(recordActiveDay, p.streak) };
    repo.saveProfile(p);
    repo.appendLog(p.id, [item({ ts: T }), item({ ts: T + 1, key: 'b' })]);
    return { repo, pid: p.id };
  }

  it('restores a device from a backup file', () => {
    const { repo, pid } = seeded();
    const file = JSON.stringify(repo.exportBackup());
    const fresh = new Repo(new MemoryKV(), () => T);
    fresh.init();
    const r = fresh.importBackup(file);
    expect(r.ok).toBe(true);
    expect(r.profilesAdded).toEqual([pid]);
    expect(fresh.loadProfile(pid)!.streak.activeDays).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
    expect(fresh.readKnownLog(pid).length).toBe(2);
  });

  it('is idempotent: importing twice changes nothing', () => {
    const { repo } = seeded();
    const file = JSON.stringify(repo.exportBackup());
    const fresh = new Repo(new MemoryKV(), () => T);
    fresh.init();
    fresh.importBackup(file);
    const snapshot = JSON.stringify([...(fresh.kv as MemoryKV).map].filter(([k]) => !k.endsWith('meta')));
    const r2 = fresh.importBackup(file);
    expect(r2.recordsAdded).toBe(0);
    expect(JSON.stringify([...(fresh.kv as MemoryKV).map].filter(([k]) => !k.endsWith('meta')))).toBe(snapshot);
  });

  it('merging an older backup never shortens a streak or loses newer progress', () => {
    const { repo, pid } = seeded();
    const oldFile = JSON.stringify(repo.exportBackup());
    const p = repo.loadProfile(pid)!;
    repo.saveProfile({ ...p, streak: recordActiveDay(p.streak, '2026-09-13'), stats: { ...p.stats, items: 50 } });
    repo.appendLog(pid, [item({ ts: T + 99, key: 'new' })]);
    const r = repo.importBackup(oldFile);
    expect(r.ok).toBe(true);
    const merged = repo.loadProfile(pid)!;
    expect(merged.streak.activeDays).toContain('2026-09-13');
    expect(merged.stats.items).toBe(50);
    expect(repo.readKnownLog(pid).length).toBe(3);
  });

  it('rejects a tampered or truncated file', () => {
    const { repo } = seeded();
    const file = repo.exportBackup();
    const bad = JSON.stringify({ ...file, entries: { ...file.entries, 'bg:rivals': '{}' } });
    const fresh = new Repo(new MemoryKV(), () => T);
    fresh.init();
    expect(fresh.importBackup(bad).error).toBe('checksum');
    expect(fresh.importBackup('{"hello":1}').error).toBe('not-a-backup');
    expect(fresh.importBackup('nope').error).toBe('not-json');
  });
});
