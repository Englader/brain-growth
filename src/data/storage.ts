/**
 * Storage bootstrap (§4 step 11): picks the KV the Repo runs on.
 *
 *   createStorage() → { kv, mode: 'idb' | 'local', … }
 *
 * 'idb': HybridKV over localStorage + IndexedDB. Log months already in
 * localStorage are relocated first, then the mirror is hydrated, so the
 * synchronous Repo sees the full history from its first read.
 *
 * 'local': today's path, unchanged: LocalStorageKV (MemoryKV if localStorage
 * is blocked). Used whenever IndexedDB is missing, broken, slow to open, or
 * relocation/hydration fails. Nothing is lost by falling back: a failed
 * relocation keeps the localStorage copy, and logs written to localStorage
 * during a fallback session are merged into IndexedDB on the next good boot.
 *
 * Single writer: a Web Lock marks the tab that may write. A second tab never
 * relocates and never persists log writes (its mirror would be stale and
 * clobber the writer's months); the app shows it a notice.
 */
import { type StorageEstimateLike } from './compaction';
import { HybridKV, relocateLogs, type DocumentLike, type EventTargetLike, type RelocationReport } from './hybridKV';
import { openIDBStore, type AsyncStore } from './idb';
import { LocalStorageKV, MemoryKV, readJSON, type KV } from './kv';
import { CURRENT_SCHEMA, KEYS, type Meta } from './schema';

// ── single writer (Web Locks) ──────────────────────────────────────────────

export const WRITER_LOCK_NAME = 'bg:writer';

/** The subset of `navigator.locks` used here. */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => unknown): Promise<unknown>;
}

export interface WriterLock {
  /** This tab may write: it holds the lock, or the API is missing and we assume so. */
  readonly writer: boolean;
  /** 'held': ours; 'busy': another tab has it; 'unsupported': no Web Locks, writer assumed. */
  readonly status: 'held' | 'busy' | 'unsupported';
  /** Lets go of a held lock (it is also released when the tab closes). */
  release(): void;
}

const assumedWriter: WriterLock = { writer: true, status: 'unsupported', release: () => undefined };

function defaultLocks(): LockManagerLike | null {
  try {
    return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
  } catch {
    return null;
  }
}

/**
 * Tries once, without waiting, to become the single writer. Holds the lock
 * until `release()` or the tab goes away. Never throws.
 */
export function acquireWriterLock(opts: { locks?: LockManagerLike | null; name?: string } = {}): Promise<WriterLock> {
  const locks = opts.locks === undefined ? defaultLocks() : opts.locks;
  if (!locks) return Promise.resolve(assumedWriter);
  return new Promise((resolve) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    try {
      locks
        .request(opts.name ?? WRITER_LOCK_NAME, { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve({ writer: false, status: 'busy', release: () => undefined });
            return undefined;
          }
          resolve({ writer: true, status: 'held', release });
          return held; // the lock lives as long as this promise is pending
        })
        .catch(() => resolve(assumedWriter));
    } catch {
      resolve(assumedWriter);
    }
  });
}

// ── createStorage ──────────────────────────────────────────────────────────

/** The subset of `navigator.storage` used here. */
export interface StorageManagerLike {
  estimate?(): Promise<StorageEstimateLike>;
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
}

export type StorageMode = 'idb' | 'local';
export type StorageFallback =
  | 'no-local-storage' // private mode / blocked: MemoryKV, nothing persists (as today)
  | 'newer-schema' // an old cached build over newer data whose logs are still in localStorage
  | 'idb-unavailable' // missing, blocked, broken or timed out
  | 'relocation-failed' // commit rejected: localStorage copy kept
  | 'hydrate-failed';

export interface StorageHandle {
  /** Give this to `new Repo(kv)`. */
  readonly kv: KV;
  readonly mode: StorageMode;
  /** Why mode is 'local' (null in 'idb' mode). */
  readonly fallback: StorageFallback | null;
  /** The HybridKV in 'idb' mode, else null. */
  readonly hybrid: HybridKV | null;
  /** Result of this boot's relocation (null when it did not run). */
  readonly relocation: RelocationReport | null;
  readonly writer: WriterLock;
  /** Meta says logs live in IndexedDB but it could not be used: history is hidden this session (not lost). */
  readonly historyUnavailable: boolean;
  /** Resolves when all log writes are durable (immediately in 'local' mode). */
  flush(): Promise<void>;
  /** Bytes in the IndexedDB log store (0 in 'local' mode). */
  idbBytes(): number;
  /** `navigator.storage.estimate()`, or null when unsupported. */
  estimate(): Promise<StorageEstimateLike | null>;
  /** Whether the origin's storage is persistent (exempt from eviction); null when unknown. */
  persisted(): Promise<boolean | null>;
  /** Asks the browser to make storage persistent ("keep data safe"). */
  persist(): Promise<boolean>;
  /** Detaches listeners, releases the lock, closes the database (tests). */
  dispose(): void;
}

export interface CreateStorageOptions {
  /** Synchronous KV for everything but logs. Default: localStorage, probed (MemoryKV if blocked). */
  local?: KV;
  /** Opens the log store. Default: IndexedDB via `openIDBStore()`. */
  openStore?: () => Promise<AsyncStore>;
  /** Default `navigator.storage`; null disables estimate/persist. */
  storageManager?: StorageManagerLike | null;
  /** Default `navigator.locks`; null = unsupported (writer assumed). */
  locks?: LockManagerLike | null;
  /** Where to flush on pagehide/visibilitychange. Default window/document; null disables. */
  lifecycle?: { window: EventTargetLike | null; document: DocumentLike | null } | null;
  flushDelayMs?: number;
  onPersistError?: (e: unknown) => void;
}

/** localStorage if it accepts a write, else an in-memory KV (private mode or storage blocked). */
export function openLocalKV(): { kv: KV; persistent: boolean } {
  try {
    const ls = window.localStorage;
    const probe = '__bg_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return { kv: new LocalStorageKV(ls), persistent: true };
  } catch {
    return { kv: new MemoryKV(), persistent: false };
  }
}

function defaultStorageManager(): StorageManagerLike | null {
  try {
    return typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null;
  } catch {
    return null;
  }
}

function defaultLifecycle(): { window: EventTargetLike | null; document: DocumentLike | null } | null {
  return typeof window !== 'undefined' && typeof document !== 'undefined' ? { window, document } : null;
}

export async function createStorage(opts: CreateStorageOptions = {}): Promise<StorageHandle> {
  const { kv: local, persistent } = opts.local ? { kv: opts.local, persistent: true } : openLocalKV();
  const sm = opts.storageManager === undefined ? defaultStorageManager() : opts.storageManager;
  const estimate = async (): Promise<StorageEstimateLike | null> => {
    try {
      const e = await sm?.estimate?.();
      return e ? { usage: e.usage, quota: e.quota } : null;
    } catch {
      return null;
    }
  };
  const common = {
    estimate,
    persisted: async (): Promise<boolean | null> => {
      try {
        return sm?.persisted ? await sm.persisted() : null;
      } catch {
        return null;
      }
    },
    persist: async (): Promise<boolean> => {
      try {
        return sm?.persist ? await sm.persist() : false;
      } catch {
        return false;
      }
    },
  };

  const writer = await acquireWriterLock({ locks: opts.locks });
  const meta = readJSON<Meta>(local, KEYS.meta);
  const logsInIdb = meta?.logStore === 'idb';
  const newer = !!meta && meta.schema > CURRENT_SCHEMA;

  const fallback = (reason: StorageFallback, relocation: RelocationReport | null = null): StorageHandle => ({
    ...common,
    kv: local,
    mode: 'local',
    fallback: reason,
    hybrid: null,
    relocation,
    writer,
    historyUnavailable: logsInIdb,
    flush: () => Promise.resolve(),
    idbBytes: () => 0,
    dispose: () => writer.release(),
  });

  if (!persistent) return fallback('no-local-storage');
  if (newer && !logsInIdb) return fallback('newer-schema');

  let store: AsyncStore;
  try {
    store = await (opts.openStore ?? (() => openIDBStore()))();
  } catch {
    return fallback('idb-unavailable');
  }

  // Only the single writer relocates: a second tab deleting localStorage copies behind the writer's mirror would lose them.
  const mayWrite = writer.writer && !newer;
  let relocation: RelocationReport | null = null;
  if (mayWrite) {
    relocation = await relocateLogs(local, store);
    if (relocation.error) {
      store.close();
      return fallback('relocation-failed', relocation);
    }
  }

  const kv = new HybridKV(local, store, {
    persist: mayWrite,
    estimate,
    flushDelayMs: opts.flushDelayMs,
    onPersistError: opts.onPersistError,
  });
  try {
    await kv.hydrate();
  } catch {
    store.close();
    return fallback('hydrate-failed', relocation);
  }
  await kv.refreshEstimate();
  const lifecycle = opts.lifecycle === undefined ? defaultLifecycle() : opts.lifecycle;
  const detach = lifecycle ? kv.attachLifecycle(lifecycle.window, lifecycle.document) : () => undefined;

  return {
    ...common,
    kv,
    mode: 'idb',
    fallback: null,
    hybrid: kv,
    relocation,
    writer,
    historyUnavailable: false,
    flush: () => kv.flush(),
    idbBytes: () => kv.idbBytes(),
    dispose: () => {
      detach();
      kv.dispose();
      store.close();
      writer.release();
    },
  };
}
