/**
 * Asynchronous key-value store for log months (DESIGN A-8, §4 step 11).
 *
 * `AsyncStore` is the small surface HybridKV needs: point reads, a full scan
 * to hydrate its in-memory mirror, and an atomic `batch` that resolves only
 * once the transaction has COMMITTED (IndexedDB `oncomplete`). Relocation
 * deletes the localStorage copy only after that promise resolves, so a
 * rejected commit can never lose data.
 *
 * Two implementations:
 *  - `IDBAsyncStore`: a dependency-free promise wrapper over one IndexedDB
 *    database with one object store. Keys are the full KV keys
 *    (`bg:log:<pid>:<YYYY-MM>`), values the same JSON strings localStorage held.
 *  - `MemoryAsyncStore`: for tests, with fault injection (rejected commits)
 *    and a gate to interleave work with an in-flight commit.
 *
 * Browser quirks handled here: IndexedDB missing or throwing on access
 * (old Firefox private mode, sandboxed frames), `open()` that never settles
 * (Safari 14.1), writes that fail in private modes (probe round-trip), and the
 * Safari "connection to Indexed Database server lost" state (reopen once).
 */
import { NS } from './kv';

export type StoreOp = { type: 'put'; key: string; value: string } | { type: 'delete'; key: string };

export interface AsyncStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** All keys, sorted. */
  keys(): Promise<string[]>;
  /** Every entry, for hydrating a mirror in one pass. */
  entries(): Promise<Array<[string, string]>>;
  /**
   * Applies every op in ONE transaction. Resolves only after the commit;
   * rejects if the transaction aborts, in which case nothing was applied.
   */
  batch(ops: readonly StoreOp[]): Promise<void>;
  close(): void;
}

// ── in-memory store (tests) ────────────────────────────────────────────────

const tick = (): Promise<void> => Promise.resolve();

export class MemoryAsyncStore implements AsyncStore {
  readonly map = new Map<string, string>();
  /** Committed write transactions. */
  commits = 0;
  closed = false;
  private readonly failures: unknown[] = [];
  private gate: Promise<void> | null = null;

  constructor(entries?: Iterable<readonly [string, string]>) {
    for (const [k, v] of entries ?? []) this.map.set(k, v);
  }

  /** The next `times` write transactions reject without applying anything (a simulated abort). */
  failNextCommit(error: unknown = new Error('simulated abort'), times = 1): void {
    for (let i = 0; i < times; i++) this.failures.push(error);
  }

  /** Holds every commit until the returned function is called. */
  hold(): () => void {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    this.gate = gate;
    return () => {
      if (this.gate === gate) this.gate = null;
      release();
    };
  }

  async get(key: string): Promise<string | null> {
    await this.ready();
    return this.map.get(key) ?? null;
  }

  put(key: string, value: string): Promise<void> {
    return this.batch([{ type: 'put', key, value }]);
  }

  delete(key: string): Promise<void> {
    return this.batch([{ type: 'delete', key }]);
  }

  async keys(): Promise<string[]> {
    await this.ready();
    return [...this.map.keys()].sort();
  }

  async entries(): Promise<Array<[string, string]>> {
    await this.ready();
    return [...this.map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  async batch(ops: readonly StoreOp[]): Promise<void> {
    const snapshot = ops.map((o) => ({ ...o }));
    await this.ready();
    while (this.gate) await this.gate;
    if (this.closed) throw new Error('store closed');
    if (this.failures.length) throw this.failures.shift();
    for (const op of snapshot) {
      if (op.type === 'put') this.map.set(op.key, op.value);
      else this.map.delete(op.key);
    }
    this.commits++;
  }

  close(): void {
    this.closed = true;
  }

  private async ready(): Promise<void> {
    await tick();
    if (this.closed) throw new Error('store closed');
  }
}

// ── IndexedDB ──────────────────────────────────────────────────────────────

/** One database for the app (the origin is shared with other Pages projects, hence the prefix). */
export const IDB_NAME = 'bg';
export const IDB_VERSION = 1;
/** One object store: log months and rollups, keyed by their full KV key. */
export const IDB_STORE = 'logs';
export const IDB_OPEN_TIMEOUT_MS = 4000;
const PROBE_KEY = `${NS}probe`;

export interface OpenIDBOptions {
  /** Defaults to the global `indexedDB`; `null` means unavailable. */
  factory?: IDBFactory | null;
  name?: string;
  timeoutMs?: number;
}

function defaultFactory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' || !indexedDB ? null : indexedDB;
  } catch {
    return null; // some sandboxed contexts throw on access
  }
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

/** Resolves on `oncomplete` (durable), rejects on abort or error. */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = (e) => reject((e.target as IDBRequest | null)?.error ?? tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function openDatabase(factory: IDBFactory, name: string, timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    };
    // Safari 14.1 can leave the first open() pending forever; a blocked upgrade waits too.
    const timer = setTimeout(() => fail(new Error(`indexedDB.open timed out after ${timeoutMs} ms`)), timeoutMs);
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name, IDB_VERSION);
    } catch (e) {
      fail(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        db.close(); // opened after we gave up
        return;
      }
      settled = true;
      clearTimeout(timer);
      // Never block another tab's future version upgrade.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = (e) => {
      e.preventDefault?.();
      fail(req.error ?? new Error('indexedDB.open failed'));
    };
  });
}

/** Errors after which a fresh connection may succeed (Safari drops connections in the background). */
function isConnectionLost(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === 'InvalidStateError' || name === 'UnknownError';
}

export class IDBAsyncStore implements AsyncStore {
  private db: IDBDatabase | null = null;
  private closed = false;

  constructor(
    db: IDBDatabase,
    private readonly reopen: () => Promise<IDBDatabase>,
  ) {
    this.attach(db);
  }

  get(key: string): Promise<string | null> {
    return this.run('readonly', async (s) => {
      const v = await request(s.get(key));
      return typeof v === 'string' ? v : null;
    });
  }

  put(key: string, value: string): Promise<void> {
    return this.batch([{ type: 'put', key, value }]);
  }

  delete(key: string): Promise<void> {
    return this.batch([{ type: 'delete', key }]);
  }

  async keys(): Promise<string[]> {
    return (await this.entries()).map(([k]) => k);
  }

  entries(): Promise<Array<[string, string]>> {
    // A plain cursor loop in callbacks: no awaits inside the transaction (older Safari commits early).
    return this.run(
      'readonly',
      (s) =>
        new Promise((resolve, reject) => {
          const out: Array<[string, string]> = [];
          const req = s.openCursor();
          req.onsuccess = () => {
            const c = req.result;
            if (!c) return resolve(out);
            if (typeof c.key === 'string' && typeof c.value === 'string') out.push([c.key, c.value]);
            c.continue();
          };
          req.onerror = () => reject(req.error ?? new Error('IndexedDB cursor failed'));
        }),
    );
  }

  batch(ops: readonly StoreOp[]): Promise<void> {
    if (!ops.length) return Promise.resolve();
    return this.run('readwrite', (s, tx) => {
      const done = committed(tx);
      try {
        for (const op of ops) {
          if (op.type === 'put') s.put(op.value, op.key);
          else s.delete(op.key);
        }
        // Commit now instead of after the request callbacks have run: a page being unloaded
        // never runs them, and its auto-commit would never happen (seen in Chromium on reload).
        // Older browsers without commit() fall back to auto-commit.
        if (typeof tx.commit === 'function') tx.commit();
      } catch (e) {
        done.catch(() => undefined);
        try {
          tx.abort();
        } catch {
          // already finished
        }
        throw e;
      }
      return done;
    });
  }

  close(): void {
    this.closed = true;
    this.db?.close();
    this.db = null;
  }

  private attach(db: IDBDatabase): void {
    this.db = db;
    // Fired when the browser closes the connection abnormally (storage cleared, Safari process loss).
    db.onclose = () => {
      if (this.db === db) this.db = null;
    };
  }

  /** Runs `fn` in a fresh transaction; after a lost connection, reopens and retries once (ops are idempotent). */
  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore, tx: IDBTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.once(mode, fn);
    } catch (e) {
      if (this.closed || !isConnectionLost(e)) throw e;
      try {
        this.db?.close();
      } catch {
        // ignore
      }
      this.db = null;
      return this.once(mode, fn);
    }
  }

  private async once<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore, tx: IDBTransaction) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('store closed');
    if (!this.db) this.attach(await this.reopen());
    const db = this.db!;
    // 'strict': oncomplete means flushed to disk, which relocation relies on before deleting localStorage.
    const tx = mode === 'readwrite' ? db.transaction(IDB_STORE, mode, { durability: 'strict' }) : db.transaction(IDB_STORE, mode);
    return fn(tx.objectStore(IDB_STORE), tx);
  }
}

/**
 * Opens the log database and proves a write commits (put + delete of a probe
 * key in one transaction, so nothing is left behind). Throws when IndexedDB
 * is missing, blocked, broken or too slow; callers fall back to localStorage.
 */
export async function openIDBStore(opts: OpenIDBOptions = {}): Promise<IDBAsyncStore> {
  const factory = opts.factory === undefined ? defaultFactory() : opts.factory;
  if (!factory) throw new Error('IndexedDB is not available');
  const name = opts.name ?? IDB_NAME;
  const timeoutMs = opts.timeoutMs ?? IDB_OPEN_TIMEOUT_MS;
  const open = (): Promise<IDBDatabase> => openDatabase(factory, name, timeoutMs);
  const store = new IDBAsyncStore(await open(), open);
  try {
    await withTimeout(
      store.batch([
        { type: 'put', key: PROBE_KEY, value: '1' },
        { type: 'delete', key: PROBE_KEY },
      ]),
      timeoutMs,
      'IndexedDB write probe',
    );
  } catch (e) {
    store.close();
    throw e;
  }
  return store;
}

/** True when IndexedDB opens and commits a write. Never throws (private modes, old Safari, sandboxes). */
export async function isIndexedDBAvailable(opts: OpenIDBOptions = {}): Promise<boolean> {
  try {
    (await openIDBStore(opts)).close();
    return true;
  } catch {
    return false;
  }
}
