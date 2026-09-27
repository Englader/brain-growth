import { describe, expect, it, vi } from 'vitest';
import { encodeRecord } from '../src/core/log/codec';
import type { ItemRecord, LogRecord } from '../src/core/log/types';
import { createProfile } from '../src/core/profile';
import { compactIfNeeded, idbOverBudget, IDB_BUDGET_BYTES, SOFT_BUDGET_BYTES, type StorageEstimateLike } from '../src/data/compaction';
import { HybridKV, isLogKey, relocateLogs } from '../src/data/hybridKV';
import { isIndexedDBAvailable, MemoryAsyncStore, openIDBStore } from '../src/data/idb';
import { MemoryKV } from '../src/data/kv';
import { Repo } from '../src/data/repo';
import { KEYS, type Meta } from '../src/data/schema';
import { acquireWriterLock, createStorage, type CreateStorageOptions, type LockManagerLike } from '../src/data/storage';

const T = Date.UTC(2026, 8, 15, 10); // 2026-09
const JAN = Date.UTC(2026, 0, 10);
const FEB = Date.UTC(2026, 1, 10);

const item = (over: Partial<ItemRecord> = {}): ItemRecord => ({
  type: 'item', ts: T, sid: 's1', key: 's1:1', skill: 'as.add.20', gen: 'addsub', genV: 1, seed: 42,
  level: 0.5, diff: 0, p: 0.84, mu: 1.2, s2: 0.4, correct: true, attempt: 1, latency: 3200, hint: false,
  answer: '13', expected: '13', mis: null, mode: 'hop', band: 'A', locale: 'mk', source: 'frontier',
  timed: false, input: 'hops', hops: 5, alt: false, ...over,
});

const chunk = (...recs: LogRecord[]): string => JSON.stringify({ v: 1, r: recs.map(encodeRecord) });
const keysOfChunk = (raw: string | null | undefined): string[] =>
  (JSON.parse(raw!) as { r: unknown[][] }).r.map((r) => String(r[4]));
const itemKeys = (recs: readonly LogRecord[]): string[] => recs.map((r) => (r.type === 'item' ? r.key : r.type));
const LOG = KEYS.log('p1', '2026-09');
const ROLL = KEYS.rollup('p1', '2026-01');
const later = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function metaJSON(over: Partial<Meta> = {}): string {
  const m: Meta = { schema: 1, deviceId: 'd', profileIds: ['p1'], activeProfileId: 'p1', createdAt: T, lastBackupAt: null, deviceFlags: {}, adultSeen: false, ...over };
  return JSON.stringify(m);
}

function hybrid(local = new MemoryKV(), store = new MemoryAsyncStore()): { kv: HybridKV; local: MemoryKV; store: MemoryAsyncStore } {
  // A long delay keeps the timer out of the way: tests flush explicitly.
  return { kv: new HybridKV(local, store, { flushDelayMs: 60_000 }), local, store };
}

/** Minimal Web Locks: exclusive; `ifAvailable` grants null when held; otherwise queues until released or aborted. */
class FakeLocks implements LockManagerLike {
  readonly held = new Set<string>();
  private readonly waiting = new Map<string, Array<() => void>>();
  async request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => unknown): Promise<unknown> {
    if (this.held.has(name)) {
      if (options.ifAvailable) return callback(null);
      await new Promise<void>((resolve, reject) => {
        const queue = this.waiting.get(name) ?? [];
        this.waiting.set(name, queue);
        queue.push(resolve);
        options.signal?.addEventListener('abort', () => {
          queue.splice(queue.indexOf(resolve), 1);
          reject(new Error('AbortError'));
        });
      });
    }
    this.held.add(name);
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
      this.waiting.get(name)?.shift()?.();
    }
  }
}

class FakeWindow extends EventTarget {}
class FakeDocument extends EventTarget {
  visibilityState = 'visible';
}

const quiet: CreateStorageOptions = { locks: null, storageManager: null, lifecycle: null, flushDelayMs: 60_000 };

describe('MemoryAsyncStore', () => {
  it('applies a batch atomically and a rejected commit applies nothing', async () => {
    const s = new MemoryAsyncStore([['a', '1']]);
    s.failNextCommit();
    await expect(s.batch([{ type: 'put', key: 'b', value: '2' }, { type: 'delete', key: 'a' }])).rejects.toThrow('simulated abort');
    expect([...s.map]).toEqual([['a', '1']]);
    await s.batch([{ type: 'put', key: 'b', value: '2' }, { type: 'delete', key: 'a' }]);
    expect(await s.entries()).toEqual([['b', '2']]);
    expect(s.commits).toBe(1);
  });
});

describe('HybridKV routing', () => {
  it('sends log and rollup keys to the mirror and everything else to localStorage', () => {
    const { kv, local } = hybrid();
    kv.set(LOG, chunk(item()));
    kv.set(ROLL, '{"v":1}');
    kv.set(KEYS.meta, metaJSON());
    kv.set(KEYS.profile('p1'), '{"id":"p1"}');
    expect(local.keys()).toEqual([KEYS.meta, KEYS.profile('p1')]);
    expect(kv.get(LOG)).toBe(chunk(item()));
    expect(kv.get(ROLL)).toBe('{"v":1}');
    expect(kv.get(KEYS.profile('p1'))).toBe('{"id":"p1"}');
    expect(isLogKey(LOG) && isLogKey(ROLL) && !isLogKey(KEYS.meta) && !isLogKey(KEYS.rivals)).toBe(true);
    kv.dispose();
  });

  it('keys() merges both stores, sorted and prefix-filtered; stray localStorage log copies are not listed', () => {
    const { kv, local } = hybrid();
    local.set(KEYS.log('p1', '2026-08'), chunk(item())); // straggler from an older build
    kv.set(KEYS.meta, metaJSON());
    kv.set(KEYS.rivals, '{}');
    kv.set(LOG, chunk(item()));
    kv.set(ROLL, '{}');
    expect(kv.keys()).toEqual([KEYS.log('p1', '2026-09'), KEYS.meta, KEYS.rivals, KEYS.rollup('p1', '2026-01')].sort());
    expect(kv.keys(KEYS.logPrefix('p1'))).toEqual([LOG]);
    expect(kv.keys(KEYS.profilePrefix)).toEqual([]);
    kv.dispose();
  });

  it('bytesUsed() counts localStorage only; idbBytes() counts the log store', () => {
    const { kv, local } = hybrid();
    kv.set(KEYS.meta, metaJSON());
    kv.set(LOG, 'x'.repeat(1000));
    expect(kv.bytesUsed()).toBe(local.bytesUsed());
    expect(kv.idbBytes()).toBe(2 * (LOG.length + 1000));
    kv.dispose();
  });

  it('remove() of a log key also clears a stray localStorage copy so it cannot come back', async () => {
    const { kv, local, store } = hybrid();
    local.set(LOG, chunk(item()));
    kv.set(LOG, chunk(item()));
    await kv.flush();
    kv.remove(LOG);
    await kv.flush();
    expect(kv.get(LOG)).toBeNull();
    expect(local.get(LOG)).toBeNull();
    expect(store.map.has(LOG)).toBe(false);
  });
});

describe('HybridKV hydration', () => {
  it('loads log keys from the store, ignores anything else, and never clobbers an earlier write', async () => {
    const store = new MemoryAsyncStore([
      [LOG, chunk(item())],
      [ROLL, '{"old":true}'],
      ['bg:probe', '1'],
    ]);
    const { kv } = hybrid(new MemoryKV(), store);
    kv.set(ROLL, '{"new":true}'); // written before hydration finished
    expect(await kv.hydrate()).toBe(1);
    expect(kv.hydrated).toBe(true);
    expect(kv.get(LOG)).toBe(chunk(item()));
    expect(kv.get(ROLL)).toBe('{"new":true}');
    expect(kv.keys()).toEqual([LOG, ROLL]);
    kv.dispose();
  });
});

describe('HybridKV write-behind', () => {
  it('queues writes, coalesces them per key, and commits them in one transaction on flush()', async () => {
    const { kv, store } = hybrid();
    kv.set(LOG, 'a');
    kv.set(LOG, 'b');
    kv.set(ROLL, 'r');
    kv.remove(ROLL);
    expect(store.map.size).toBe(0);
    expect(kv.pendingWrites).toBe(2);
    await kv.flush();
    expect([...store.map]).toEqual([[LOG, 'b']]);
    expect(store.commits).toBe(1);
    expect(kv.pendingWrites).toBe(0);
    await kv.flush(); // nothing queued: no empty transaction
    expect(store.commits).toBe(1);
  });

  it('flushes by itself after the coalescing delay', async () => {
    const store = new MemoryAsyncStore();
    const kv = new HybridKV(new MemoryKV(), store, { flushDelayMs: 5 });
    kv.set(LOG, 'a');
    kv.set(LOG, 'b');
    await vi.waitFor(() => expect(store.map.get(LOG)).toBe('b'));
    expect(store.commits).toBe(1);
  });

  it('flush() resolves only once the commit has completed; concurrent calls chain', async () => {
    const { kv, store } = hybrid();
    const release = store.hold();
    kv.set(LOG, 'a');
    let done = false;
    const first = kv.flush().then(() => (done = true));
    kv.set(ROLL, 'r');
    const second = kv.flush();
    await later();
    expect(done).toBe(false);
    expect(store.map.size).toBe(0);
    release();
    await Promise.all([first, second]);
    expect(store.map.get(LOG)).toBe('a');
    expect(store.map.get(ROLL)).toBe('r');
    expect(store.commits).toBe(2);
  });

  it('a rejected commit keeps the writes queued, reports the error, and a newer write wins over the retry', async () => {
    const errors: unknown[] = [];
    const store = new MemoryAsyncStore();
    const kv = new HybridKV(new MemoryKV(), store, { flushDelayMs: 60_000, onPersistError: (e) => errors.push(e) });
    store.failNextCommit();
    const release = store.hold();
    kv.set(LOG, 'v1');
    kv.set(ROLL, 'r1');
    const failing = kv.flush();
    kv.set(LOG, 'v2'); // arrives while the failing commit is in flight
    release();
    await expect(failing).rejects.toThrow('simulated abort');
    expect(errors).toHaveLength(1);
    expect(kv.lastError).toBeInstanceOf(Error);
    expect(kv.pendingWrites).toBe(2);
    expect(kv.get(LOG)).toBe('v2'); // reads never depend on persistence
    await kv.flush();
    expect(store.map.get(LOG)).toBe('v2');
    expect(store.map.get(ROLL)).toBe('r1');
    expect(kv.lastError).toBeNull();
    kv.dispose();
  });

  it('flushes on pagehide and when the page becomes hidden', async () => {
    const { kv, store } = hybrid();
    const win = new FakeWindow();
    const doc = new FakeDocument();
    const detach = kv.attachLifecycle(win, doc);
    kv.set(LOG, 'a');
    doc.dispatchEvent(new Event('visibilitychange')); // still visible: nothing happens
    await later();
    expect(store.map.size).toBe(0);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(store.map.get(LOG)).toBe('a'));
    kv.set(LOG, 'b');
    win.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(store.map.get(LOG)).toBe('b'));
    detach();
    kv.set(LOG, 'c');
    win.dispatchEvent(new Event('pagehide'));
    await later();
    expect(store.map.get(LOG)).toBe('b');
    kv.dispose();
  });

  it('with persist:false (not the writer) never writes to the store', async () => {
    const store = new MemoryAsyncStore();
    const kv = new HybridKV(new MemoryKV(), store, { persist: false, flushDelayMs: 1 });
    kv.set(LOG, 'a');
    await kv.flush();
    await new Promise((r) => setTimeout(r, 10));
    expect(store.map.size).toBe(0);
    expect(kv.get(LOG)).toBe('a');
  });
});

describe('relocation localStorage → IndexedDB', () => {
  const A = item({ ts: T, key: 'A' });
  const B = item({ ts: T + 1, key: 'B' });
  const C = item({ ts: T + 2, key: 'C' });

  function oldBuildData(): MemoryKV {
    const local = new MemoryKV();
    local.set(KEYS.meta, metaJSON());
    local.set(KEYS.profile('p1'), '{"id":"p1"}');
    local.set(LOG, chunk(A, B));
    local.set(ROLL, '{"v":1,"month":"2026-01"}');
    return local;
  }

  it('moves log and rollup keys, deletes the localStorage copies, and records Meta.logStore', async () => {
    const local = oldBuildData();
    const store = new MemoryAsyncStore();
    const r = await relocateLogs(local, store);
    expect(r.error).toBeNull();
    expect(r.moved).toEqual([LOG, ROLL]);
    expect(store.map.get(LOG)).toBe(chunk(A, B));
    expect(store.map.get(ROLL)).toBe('{"v":1,"month":"2026-01"}');
    expect(local.keys()).toEqual([KEYS.meta, KEYS.profile('p1')]);
    expect((JSON.parse(local.get(KEYS.meta)!) as Meta).logStore).toBe('idb');
    expect((JSON.parse(local.get(KEYS.meta)!) as Meta).schema).toBe(1); // no schema bump
    expect(store.commits).toBe(1);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const local = oldBuildData();
    const store = new MemoryAsyncStore();
    await relocateLogs(local, store);
    const before = JSON.stringify([...store.map]);
    const localBefore = JSON.stringify([...local.map]);
    const r = await relocateLogs(local, store);
    expect(r).toMatchObject({ moved: [], merged: [], kept: [], recordsAdded: 0, error: null });
    expect(JSON.stringify([...store.map])).toBe(before);
    expect(JSON.stringify([...local.map])).toBe(localBefore);
  });

  it('is crash-safe: a rejected commit keeps every localStorage copy, and the next run completes', async () => {
    const local = oldBuildData();
    const snapshot = JSON.stringify([...local.map]);
    const store = new MemoryAsyncStore();
    store.failNextCommit(new Error('QuotaExceededError'));
    const r = await relocateLogs(local, store);
    expect(r.error).toBe('QuotaExceededError');
    expect(r.moved).toEqual([]);
    expect(store.map.size).toBe(0);
    expect(JSON.stringify([...local.map])).toBe(snapshot); // untouched, meta included
    const again = await relocateLogs(local, store);
    expect(again.moved).toEqual([LOG, ROLL]);
    expect(local.keys('bg:log:')).toEqual([]);
  });

  it('a crash between commit and delete leaves two identical copies; the next run de-duplicates', async () => {
    const local = oldBuildData();
    const store = new MemoryAsyncStore([[LOG, chunk(A, B)]]);
    const r = await relocateLogs(local, store);
    expect(r.merged).toContain(LOG);
    expect(r.recordsAdded).toBe(0);
    expect(keysOfChunk(store.map.get(LOG))).toEqual(['A', 'B']);
    expect(local.get(LOG)).toBeNull();
  });

  it('merges stragglers written later by an older cached build (union by record identity, ordered by time)', async () => {
    const local = new MemoryKV();
    local.set(KEYS.meta, metaJSON({ logStore: 'idb' }));
    local.set(LOG, chunk(A, C)); // old build: re-created the month with A (dupe) and new C
    const store = new MemoryAsyncStore([[LOG, chunk(B, A)]]);
    const r = await relocateLogs(local, store);
    expect(r).toMatchObject({ moved: [LOG], merged: [LOG], recordsAdded: 1, error: null });
    expect(keysOfChunk(store.map.get(LOG))).toEqual(['A', 'B', 'C']);
    expect(local.get(LOG)).toBeNull();
  });

  it('keeps a localStorage copy that changed while the commit was in flight, and merges it next run', async () => {
    const local = new MemoryKV();
    local.set(LOG, chunk(A));
    const store = new MemoryAsyncStore();
    const release = store.hold();
    const run = relocateLogs(local, store);
    await later();
    local.set(LOG, chunk(A, C)); // another tab on an older build appended meanwhile
    release();
    const r = await run;
    expect(r.kept).toEqual([LOG]);
    expect(r.moved).toEqual([]);
    expect(local.get(LOG)).toBe(chunk(A, C));
    const next = await relocateLogs(local, store);
    expect(next.moved).toEqual([LOG]);
    expect(keysOfChunk(store.map.get(LOG))).toEqual(['A', 'C']);
  });

  it('rollups: the store copy wins (backup-import rule); unreadable log copies are kept, never deleted', async () => {
    const local = new MemoryKV();
    local.set(ROLL, '{"local":1}');
    local.set(LOG, 'not json');
    const store = new MemoryAsyncStore([
      [ROLL, '{"store":1}'],
      [LOG, chunk(A)],
    ]);
    const r = await relocateLogs(local, store);
    expect(store.map.get(ROLL)).toBe('{"store":1}');
    expect(local.get(ROLL)).toBeNull();
    expect(r.kept).toEqual([LOG]);
    expect(local.get(LOG)).toBe('not json');
    // With no store copy, even an unreadable value moves verbatim (lossless).
    const fresh = new MemoryAsyncStore();
    await relocateLogs(local, fresh);
    expect(fresh.map.get(LOG)).toBe('not json');
  });

  it('never writes to data from a newer schema', async () => {
    const local = new MemoryKV();
    local.set(KEYS.meta, metaJSON({ schema: 99 }));
    local.set(LOG, chunk(A));
    const store = new MemoryAsyncStore();
    const r = await relocateLogs(local, store);
    expect(r.skipped).toBe('newer-schema');
    expect(local.get(LOG)).toBe(chunk(A));
    expect(store.map.size).toBe(0);
    expect((JSON.parse(local.get(KEYS.meta)!) as Meta).logStore).toBeUndefined();
  });
});

describe('Repo over HybridKV: backup export and import', () => {
  async function hybridRepo(): Promise<{ repo: Repo; kv: HybridKV; local: MemoryKV; store: MemoryAsyncStore }> {
    const h = hybrid();
    await h.kv.hydrate();
    const repo = new Repo(h.kv, () => T);
    repo.init();
    return { repo, ...h };
  }

  it('exports logs from IndexedDB and imports them back into IndexedDB, idempotently', async () => {
    const a = await hybridRepo();
    const p = a.repo.saveProfile(createProfile({ name: 'Ана', age: 7, locale: 'mk', avatar: 'color.green' }, T));
    a.repo.appendLog(p.id, [item({ ts: T }), item({ ts: T + 1, key: 'b' }), item({ ts: FEB, key: 'feb' })]);
    await a.repo.flush();
    expect(a.local.keys('bg:log:')).toEqual([]);
    expect(await a.store.keys()).toEqual([KEYS.log(p.id, '2026-02'), KEYS.log(p.id, '2026-09')]);
    expect(a.repo.meta().logStore).toBe('idb');
    const usage = a.repo.usage();
    expect(usage.idbBytes).toBe(a.kv.idbBytes());
    expect(usage.bytes).toBe(a.local.bytesUsed());

    const file = a.repo.exportBackup();
    expect(Object.keys(file.entries)).toEqual(expect.arrayContaining([KEYS.log(p.id, '2026-02'), KEYS.log(p.id, '2026-09'), KEYS.profile(p.id)]));

    const b = await hybridRepo();
    const r = b.repo.importBackup(JSON.stringify(file));
    expect(r).toMatchObject({ ok: true, profilesAdded: [p.id], recordsAdded: 3 });
    await b.repo.flush();
    expect(b.local.keys('bg:log:')).toEqual([]);
    expect(b.store.map.size).toBe(2);
    expect(b.repo.importBackup(JSON.stringify(file)).recordsAdded).toBe(0);

    // Next boot: a fresh mirror over the same stores sees the imported history.
    const next = new HybridKV(b.local, b.store);
    await next.hydrate();
    expect(itemKeys(new Repo(next, () => T).readKnownLog(p.id))).toEqual(['feb', 's1:1', 'b']);
    a.kv.dispose();
    b.kv.dispose();
  });

  it('deleteProfile removes the profile logs from IndexedDB', async () => {
    const a = await hybridRepo();
    const p = a.repo.saveProfile(createProfile({ name: 'B', age: 9, locale: 'en', avatar: 'color.green' }, T));
    a.repo.appendLog(p.id, [item()]);
    await a.repo.flush();
    a.repo.deleteProfile(p.id);
    await a.repo.flush();
    expect(a.store.map.size).toBe(0);
    expect(a.kv.keys()).toEqual([KEYS.meta]);
  });
});

describe('compaction budget per store', () => {
  const oldMonths = (kv: { set(k: string, v: string): void }): void => {
    kv.set(KEYS.log('p1', '2026-01'), chunk(...Array.from({ length: 50 }, (_, i) => item({ ts: JAN + i, key: `j${i}` }))));
    kv.set(KEYS.log('p1', '2026-02'), chunk(...Array.from({ length: 50 }, (_, i) => item({ ts: FEB + i, key: `f${i}` }))));
  };

  it('IndexedDB budget: above ~50 MB, or more than 50% of the quota used', () => {
    expect(idbOverBudget(IDB_BUDGET_BYTES + 1)).toBe(true);
    expect(idbOverBudget(IDB_BUDGET_BYTES - 1)).toBe(false);
    expect(idbOverBudget(0, { usage: 51, quota: 100 })).toBe(true);
    expect(idbOverBudget(0, { usage: 50, quota: 100 })).toBe(false);
    expect(idbOverBudget(0, { usage: 99 })).toBe(false);
    expect(idbOverBudget(0, { usage: 1, quota: 0 })).toBe(false);
    expect(idbOverBudget(0, null)).toBe(false);
  });

  it('localStorage keeps the 3.5 MB soft budget', () => {
    const kv = new MemoryKV();
    oldMonths(kv);
    expect(compactIfNeeded(kv, '2026-09')).toEqual([]);
    kv.set(KEYS.profile('big'), 'x'.repeat(SOFT_BUDGET_BYTES / 2));
    expect(compactIfNeeded(kv, '2026-09')).toEqual(['p1:2026-01', 'p1:2026-02']);
  });

  it('log months in IndexedDB ignore the localStorage budget, and forcing after a localStorage quota error is a no-op', () => {
    const { kv, local } = hybrid();
    oldMonths(kv);
    local.set(KEYS.profile('big'), 'x'.repeat(SOFT_BUDGET_BYTES / 2));
    expect(kv.bytesUsed()).toBeGreaterThan(SOFT_BUDGET_BYTES);
    expect(compactIfNeeded(kv, '2026-09')).toEqual([]);
    expect(compactIfNeeded(kv, '2026-09', true)).toEqual([]);
    expect(kv.keys('bg:log:')).toHaveLength(2);
    kv.dispose();
  });

  it('compacts when the storage estimate reports > 50% used, and stops once compaction has freed enough', async () => {
    let estimate: StorageEstimateLike = { usage: 400, quota: 1000 };
    const kv = new HybridKV(new MemoryKV(), new MemoryAsyncStore(), { flushDelayMs: 60_000, estimate: async () => estimate });
    oldMonths(kv);
    await kv.refreshEstimate();
    expect(compactIfNeeded(kv, '2026-09')).toEqual([]);

    estimate = { usage: 500_000_001, quota: 1_000_000_000 }; // just over half
    await kv.refreshEstimate();
    expect(compactIfNeeded(kv, '2026-09')).toEqual(['p1:2026-01']);
    expect(kv.get(KEYS.rollup('p1', '2026-01'))).not.toBeNull();

    estimate = { usage: 900, quota: 1000 };
    await kv.refreshEstimate();
    expect(compactIfNeeded(kv, '2026-09')).toEqual(['p1:2026-02']);
    kv.dispose();
  });
});

describe('createStorage', () => {
  /** Data as the current localStorage-only build leaves it. */
  function legacyLocal(): { local: MemoryKV; pid: string } {
    const local = new MemoryKV();
    const old = new Repo(local, () => T);
    old.init();
    const p = old.saveProfile(createProfile({ name: 'Марко', age: 9, locale: 'mk', avatar: 'color.green' }, T));
    old.appendLog(p.id, [item({ ts: JAN, key: 'jan' }), item({ ts: T, key: 'sep' })]);
    return { local, pid: p.id };
  }

  it("'idb' mode: relocates, hydrates and flushes on pagehide; the Repo sees the full history", async () => {
    const { local, pid } = legacyLocal();
    const store = new MemoryAsyncStore();
    const win = new FakeWindow();
    const s = await createStorage({ ...quiet, local, openStore: async () => store, locks: new FakeLocks(), lifecycle: { window: win, document: new FakeDocument() } });
    expect(s.mode).toBe('idb');
    expect(s.fallback).toBeNull();
    expect(s.writer).toMatchObject({ writer: true, status: 'held' });
    expect(s.relocation!.moved).toEqual([KEYS.log(pid, '2026-01'), KEYS.log(pid, '2026-09')]);
    expect(local.keys('bg:log:')).toEqual([]);

    const repo = new Repo(s.kv, () => T);
    repo.init();
    expect(repo.meta().logStore).toBe('idb');
    expect(itemKeys(repo.readKnownLog(pid))).toEqual(['jan', 'sep']);
    repo.appendLog(pid, [item({ ts: T + 5, key: 'new' })]);
    expect(s.hybrid!.pendingWrites).toBe(1);
    win.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(keysOfChunk(store.map.get(KEYS.log(pid, '2026-09')))).toEqual(['sep', 'new']));
    expect(s.idbBytes()).toBe(s.hybrid!.idbBytes());
    s.dispose();
  });

  it('records Meta.logStore on a fresh install too (meta does not exist yet at relocation time)', async () => {
    const s = await createStorage({ ...quiet, local: new MemoryKV(), openStore: async () => new MemoryAsyncStore() });
    const repo = new Repo(s.kv, () => T);
    expect(repo.init().freshInstall).toBe(true);
    expect(repo.meta().logStore).toBe('idb');
    s.dispose();
  });

  it("falls back to today's localStorage path when IndexedDB is unavailable", async () => {
    const { local, pid } = legacyLocal();
    const s = await createStorage({ ...quiet, local, openStore: () => Promise.reject(new Error('no idb')) });
    expect(s).toMatchObject({ mode: 'local', fallback: 'idb-unavailable', hybrid: null, historyUnavailable: false });
    expect(s.kv).toBe(local);
    expect(new Repo(s.kv, () => T).readKnownLog(pid)).toHaveLength(2);
    expect(s.idbBytes()).toBe(0);
    await expect(s.flush()).resolves.toBeUndefined();
  });

  it('flags hidden history when meta says the logs live in IndexedDB but it cannot be opened', async () => {
    const local = new MemoryKV();
    local.set(KEYS.meta, metaJSON({ logStore: 'idb' }));
    const s = await createStorage({ ...quiet, local, openStore: () => Promise.reject(new Error('no idb')) });
    expect(s).toMatchObject({ mode: 'local', historyUnavailable: true });
  });

  it('a rejected relocation commit falls back to localStorage with every copy intact', async () => {
    const { local, pid } = legacyLocal();
    const before = JSON.stringify([...local.map]);
    const store = new MemoryAsyncStore();
    store.failNextCommit();
    const s = await createStorage({ ...quiet, local, openStore: async () => store });
    expect(s).toMatchObject({ mode: 'local', fallback: 'relocation-failed' });
    expect(s.relocation!.error).toBe('simulated abort');
    expect(JSON.stringify([...local.map])).toBe(before);
    expect(store.map.size).toBe(0);
    expect(store.closed).toBe(true); // the fallback releases the connection
    // Next boot (a new connection to the same database) succeeds.
    const reopened = new MemoryAsyncStore(store.map);
    const next = await createStorage({ ...quiet, local, openStore: async () => reopened });
    expect(next.mode).toBe('idb');
    expect(local.keys('bg:log:')).toEqual([]);
    expect(reopened.map.size).toBe(2);
    expect(new Repo(next.kv, () => T).readKnownLog(pid)).toHaveLength(2);
    next.dispose();
  });

  it('falls back when hydration fails; relocated logs stay safe in the store', async () => {
    class BrokenScan extends MemoryAsyncStore {
      override entries(): Promise<Array<[string, string]>> {
        return Promise.reject(new Error('scan failed'));
      }
    }
    const { local } = legacyLocal();
    const store = new BrokenScan();
    const s = await createStorage({ ...quiet, local, openStore: async () => store });
    expect(s).toMatchObject({ mode: 'local', fallback: 'hydrate-failed', historyUnavailable: false });
    expect(store.map.size).toBe(2);
  });

  it('uses an in-memory KV and no IndexedDB when localStorage itself is unavailable', async () => {
    const openStore = vi.fn(async () => new MemoryAsyncStore());
    const s = await createStorage({ ...quiet, openStore }); // no window in this test environment
    expect(s).toMatchObject({ mode: 'local', fallback: 'no-local-storage' });
    expect(s.kv).toBeInstanceOf(MemoryKV);
    expect(openStore).not.toHaveBeenCalled();
  });

  it('a second tab gets writer:false, does not relocate, and never persists log writes', async () => {
    const { local } = legacyLocal();
    const locks = new FakeLocks();
    const firstTab = await acquireWriterLock({ locks });
    const store = new MemoryAsyncStore();
    const s = await createStorage({ ...quiet, local, openStore: async () => store, locks, lockWaitMs: 20 });
    expect(s.mode).toBe('idb');
    expect(s.writer).toMatchObject({ writer: false, status: 'busy' });
    expect(s.relocation).toBeNull();
    expect(local.keys('bg:log:')).toHaveLength(2);
    s.kv.set(LOG, 'x');
    await s.flush();
    expect(store.map.size).toBe(0);
    firstTab.release();
    s.dispose();
  });

  it('data from a newer schema: logs in IndexedDB are read but never written; logs in localStorage stay put', async () => {
    const local = new MemoryKV();
    local.set(KEYS.meta, metaJSON({ schema: 99, logStore: 'idb' }));
    local.set(LOG, chunk(item({ key: 'straggler' })));
    const store = new MemoryAsyncStore([[KEYS.log('p1', '2026-08'), chunk(item({ key: 'aug' }))]]);
    const s = await createStorage({ ...quiet, local, openStore: async () => store });
    expect(s.mode).toBe('idb');
    expect(s.relocation).toBeNull();
    expect(s.kv.get(KEYS.log('p1', '2026-08'))).not.toBeNull();
    expect(local.get(LOG)).not.toBeNull();
    s.kv.set(KEYS.log('p1', '2026-08'), 'x');
    await s.flush();
    expect(keysOfChunk(store.map.get(KEYS.log('p1', '2026-08')))).toEqual(['aug']);
    s.dispose();

    const plain = new MemoryKV();
    plain.set(KEYS.meta, metaJSON({ schema: 99 }));
    expect(await createStorage({ ...quiet, local: plain, openStore: async () => store })).toMatchObject({ mode: 'local', fallback: 'newer-schema' });
  });

  it('exposes storage estimate and persistence, and degrades when navigator.storage is missing', async () => {
    const storageManager = { estimate: async () => ({ usage: 10, quota: 100 }), persist: async () => true, persisted: async () => false };
    const s = await createStorage({ ...quiet, local: new MemoryKV(), openStore: async () => new MemoryAsyncStore(), storageManager });
    expect(await s.estimate()).toEqual({ usage: 10, quota: 100 });
    expect(await s.persist()).toBe(true);
    expect(await s.persisted()).toBe(false);
    s.dispose();
    const bare = await createStorage({ ...quiet, local: new MemoryKV(), openStore: async () => new MemoryAsyncStore() });
    expect(await bare.estimate()).toBeNull();
    expect(await bare.persist()).toBe(false);
    expect(await bare.persisted()).toBeNull();
    bare.dispose();
  });
});

describe('single writer (Web Locks)', () => {
  it('grants the lock to one tab at a time and hands it over on release', async () => {
    const locks = new FakeLocks();
    const a = await acquireWriterLock({ locks });
    const b = await acquireWriterLock({ locks, waitMs: 20 });
    expect(a).toMatchObject({ writer: true, status: 'held' });
    expect(b).toMatchObject({ writer: false, status: 'busy' });
    a.release();
    await later();
    expect(await acquireWriterLock({ locks, waitMs: 20 })).toMatchObject({ writer: true, status: 'held' });
    expect(await acquireWriterLock({ locks, waitMs: 0 })).toMatchObject({ writer: false, status: 'busy' }); // ifAvailable path
  });

  it('a reload is not a second tab: it waits briefly for the previous page to let go', async () => {
    const locks = new FakeLocks();
    const previousPage = await acquireWriterLock({ locks });
    const reloaded = acquireWriterLock({ locks, waitMs: 1000 });
    setTimeout(() => previousPage.release(), 10); // released a moment after the new page starts
    expect(await reloaded).toMatchObject({ writer: true, status: 'held' });
  });

  it('assumes this tab is the writer when the API is missing or throws', async () => {
    expect(await acquireWriterLock({ locks: null })).toMatchObject({ writer: true, status: 'unsupported' });
    const throwing: LockManagerLike = { request: () => { throw new Error('SecurityError'); } };
    expect(await acquireWriterLock({ locks: throwing })).toMatchObject({ writer: true, status: 'unsupported' });
    const rejecting: LockManagerLike = { request: () => Promise.reject(new Error('nope')) };
    expect(await acquireWriterLock({ locks: rejecting })).toMatchObject({ writer: true, status: 'unsupported' });
  });
});

describe('IndexedDB availability probe', () => {
  it('fails safely: missing, throwing, erroring or never-settling indexedDB.open()', async () => {
    expect(await isIndexedDBAvailable({ factory: null })).toBe(false);
    const throwing = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    expect(await isIndexedDBAvailable({ factory: throwing })).toBe(false);
    const erroring = {
      open: () => {
        const req: { error?: Error; onerror?: (e: { preventDefault(): void }) => void } = {};
        setTimeout(() => {
          req.error = new Error('InvalidStateError');
          req.onerror?.({ preventDefault: () => undefined });
        }, 0);
        return req;
      },
    } as unknown as IDBFactory;
    expect(await isIndexedDBAvailable({ factory: erroring })).toBe(false);
    const hanging = { open: () => ({}) } as unknown as IDBFactory; // Safari 14.1
    expect(await isIndexedDBAvailable({ factory: hanging, timeoutMs: 20 })).toBe(false);
    await expect(openIDBStore({ factory: hanging, timeoutMs: 20 })).rejects.toThrow(/timed out/);
    // In this Node test environment there is no global indexedDB.
    expect(await isIndexedDBAvailable()).toBe(false);
  });
});
