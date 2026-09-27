/**
 * HybridKV: the synchronous `KV` the app already uses, with log months kept
 * in IndexedDB (DESIGN A-8, §4 step 11).
 *
 *  - `bg:log:*` and `bg:rollup:*` live in an in-memory mirror, hydrated from an
 *    `AsyncStore` before boot and persisted by a coalescing write-behind queue.
 *  - Everything else (meta, profiles, rivals, migration backups) goes straight
 *    to the wrapped synchronous KV (`LocalStorageKV` in production).
 *  - `keys()` merges both stores, so backup export/import, deleteProfile and
 *    compaction work unchanged. A log key is always served by the mirror; a
 *    stray copy left in localStorage by an older cached build is not listed
 *    and is merged into IndexedDB by `relocateLogs()` on the next boot.
 *  - `bytesUsed()` is localStorage only (the ~5 MB budget); `idbBytes()` is the
 *    log store, which has its own compaction budget (`logsOverBudget()`).
 */
import { decodeRecord, recordIdentity } from '../core/log/codec';
import { idbOverBudget, type StorageEstimateLike } from './compaction';
import type { AsyncStore, StoreOp } from './idb';
import { NS, readJSON, type KV } from './kv';
import { CURRENT_SCHEMA, KEYS, type LogChunk, type Meta } from './schema';

export const LOG_KEY_PREFIXES = [`${NS}log:`, `${NS}rollup:`] as const;

/** Keys that live in the log store. */
export function isLogKey(key: string): boolean {
  return key.startsWith(LOG_KEY_PREFIXES[0]) || key.startsWith(LOG_KEY_PREFIXES[1]);
}

export const DEFAULT_FLUSH_DELAY_MS = 250;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 60_000;

export interface EventTargetLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface DocumentLike extends EventTargetLike {
  readonly visibilityState: string;
}

export interface HybridKVOptions {
  /** Coalescing window for the write-behind queue. */
  flushDelayMs?: number;
  /** `navigator.storage.estimate`, used by the log-store compaction budget. */
  estimate?: () => Promise<StorageEstimateLike | null | undefined>;
  /**
   * false: log writes stay in the mirror and are never persisted. Used when
   * another tab is the single writer (its IndexedDB data must not be
   * clobbered by this tab's stale mirror) or the data is from a newer schema.
   */
  persist?: boolean;
  /** Called whenever a flush fails; the writes stay queued and are retried with backoff. */
  onPersistError?: (e: unknown) => void;
}

export class HybridKV implements KV {
  readonly logStore = 'idb' as const;
  /** True once `hydrate()` has loaded the log store. */
  hydrated = false;
  /** Error of the last failed flush (null after a successful one). */
  lastError: unknown = null;

  private readonly mirror = new Map<string, string>();
  /** key → value to put, or null to delete. Last write wins. */
  private readonly pending = new Map<string, string | null>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private retryMs = 0;
  private estimated: { estimate: StorageEstimateLike; idbBytes: number } | null = null;
  private disposed = false;

  constructor(
    readonly local: KV,
    readonly store: AsyncStore,
    private readonly opts: HybridKVOptions = {},
  ) {}

  /** Loads every log key from the store into the mirror. Never overwrites a write made before it finished. */
  async hydrate(): Promise<number> {
    const entries = await this.store.entries();
    let n = 0;
    for (const [k, v] of entries) {
      if (!isLogKey(k) || typeof v !== 'string' || this.mirror.has(k) || this.pending.has(k)) continue;
      this.mirror.set(k, v);
      n++;
    }
    this.hydrated = true;
    return n;
  }

  // ── KV ──
  get(key: string): string | null {
    return isLogKey(key) ? (this.mirror.get(key) ?? null) : this.local.get(key);
  }

  set(key: string, value: string): void {
    if (!isLogKey(key)) return this.local.set(key, value);
    this.mirror.set(key, value);
    this.enqueue(key, value);
  }

  remove(key: string): void {
    if (!isLogKey(key)) return this.local.remove(key);
    this.mirror.delete(key);
    this.enqueue(key, null);
    // A stray copy from an older build must not bring a deleted month back at the next relocation.
    if (this.local.get(key) !== null) this.local.remove(key);
  }

  keys(prefix = NS): string[] {
    const out = this.local.keys(prefix).filter((k) => !isLogKey(k));
    for (const k of this.mirror.keys()) if (k.startsWith(prefix)) out.push(k);
    return out.sort();
  }

  /** localStorage only: the store with the ~5 MB origin quota. */
  bytesUsed(): number {
    return this.local.bytesUsed();
  }

  /** The log store, in the same UTF-16 measure (2 bytes per char). */
  idbBytes(): number {
    let n = 0;
    for (const [k, v] of this.mirror) n += 2 * (k.length + v.length);
    return n;
  }

  /** Log-store compaction budget: above ~50 MB, or the last estimate showing > 50% of quota used. */
  logsOverBudget(): boolean {
    return idbOverBudget(this.idbBytes(), this.currentEstimate());
  }

  // ── storage estimate ──
  /** Re-reads the storage estimate for the compaction budget (call before `Repo.maintain()`). */
  async refreshEstimate(): Promise<StorageEstimateLike | null> {
    if (!this.opts.estimate) return null;
    try {
      const e = await this.opts.estimate();
      this.estimated = e ? { estimate: { usage: e.usage, quota: e.quota }, idbBytes: this.idbBytes() } : null;
    } catch {
      this.estimated = null;
    }
    return this.estimated?.estimate ?? null;
  }

  /**
   * The last estimate, minus what compaction has freed since. UTF-16 bytes
   * overstate disk bytes, so this errs towards stopping early and keeping raw
   * history.
   */
  private currentEstimate(): StorageEstimateLike | null {
    if (!this.estimated) return null;
    const { estimate, idbBytes } = this.estimated;
    if (typeof estimate.usage !== 'number') return estimate;
    return { ...estimate, usage: Math.max(0, estimate.usage - Math.max(0, idbBytes - this.idbBytes())) };
  }

  // ── write-behind ──
  /** Writes accepted but not yet committed. */
  get pendingWrites(): number {
    return this.pending.size;
  }

  /**
   * Commits every queued write in one transaction. Resolves once it is
   * durable; rejects if the commit fails (the writes stay queued and a retry
   * is scheduled). Concurrent calls chain behind the flush in flight.
   */
  flush(): Promise<void> {
    this.clearTimer();
    if (this.inflight) return this.inflight.catch(() => undefined).then(() => this.flush());
    if (!this.pending.size || this.opts.persist === false) return Promise.resolve();
    const taken = new Map(this.pending);
    this.pending.clear();
    const ops: StoreOp[] = [...taken].map(([key, value]) => (value === null ? { type: 'delete', key } : { type: 'put', key, value }));
    const attempt = this.store.batch(ops).then(
      () => {
        this.lastError = null;
        this.retryMs = 0;
      },
      (e: unknown) => {
        // Re-queue, unless a newer write for the same key arrived meanwhile.
        for (const [k, v] of taken) if (!this.pending.has(k)) this.pending.set(k, v);
        this.lastError = e;
        this.retryMs = Math.min(this.retryMs ? this.retryMs * 2 : RETRY_MIN_MS, RETRY_MAX_MS);
        this.opts.onPersistError?.(e);
        throw e;
      },
    );
    const tracked: Promise<void> = attempt.finally(() => {
      if (this.inflight === tracked) this.inflight = null;
      if (this.pending.size) this.schedule(this.retryMs || this.delay());
    });
    this.inflight = tracked;
    return tracked;
  }

  /**
   * Flushes when the page is hidden or unloaded (`visibilitychange` → hidden,
   * `pagehide`): the last moments a mobile browser reliably gives us.
   * Returns a function that detaches the listeners.
   */
  attachLifecycle(win: EventTargetLike | null, doc: DocumentLike | null): () => void {
    const flushNow = (): void => {
      void this.flush().catch(() => undefined);
    };
    const onVisibility = (): void => {
      if (doc?.visibilityState === 'hidden') flushNow();
    };
    win?.addEventListener('pagehide', flushNow);
    doc?.addEventListener('visibilitychange', onVisibility);
    return () => {
      win?.removeEventListener('pagehide', flushNow);
      doc?.removeEventListener('visibilitychange', onVisibility);
    };
  }

  /** Stops the timer; queued writes are kept (call `flush()` first to persist them). */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private enqueue(key: string, value: string | null): void {
    this.pending.set(key, value);
    this.schedule(this.delay());
  }

  private delay(): number {
    return this.opts.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
  }

  private schedule(ms: number): void {
    if (this.timer !== null || this.disposed || this.opts.persist === false) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

// ── relocation: localStorage → log store ───────────────────────────────────

export interface RelocationReport {
  /** Keys committed to the store and then removed from localStorage. */
  moved: string[];
  /** Keys that already existed in the store and were merged (union by record identity). */
  merged: string[];
  /** Keys left in localStorage (changed during the run, or unreadable while the store also had them); retried next run. */
  kept: string[];
  /** Records added to months that already existed in the store. */
  recordsAdded: number;
  /** Set when nothing was done on purpose. */
  skipped: 'newer-schema' | null;
  /** Set when reading the store or committing failed; localStorage is then untouched. */
  error: string | null;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Union of two copies of the same month, by `recordIdentity`, ordered by time.
 * Returns undefined when either copy is unreadable (then nothing is deleted).
 */
function unionChunks(storeRaw: string, localRaw: string): { value: string; added: number } | undefined {
  const parse = (raw: string): LogChunk | null => {
    try {
      const c = JSON.parse(raw) as LogChunk;
      return c && Array.isArray(c.r) ? c : null;
    } catch {
      return null;
    }
  };
  const ours = parse(storeRaw);
  const theirs = parse(localRaw);
  if (!ours || !theirs) return undefined;
  const seen = new Set(ours.r.map(recordIdentity));
  const add: unknown[] = [];
  for (const r of theirs.r) {
    const id = recordIdentity(r);
    if (seen.has(id)) continue;
    seen.add(id);
    add.push(r);
  }
  if (!add.length) return { value: storeRaw, added: 0 };
  const merged = [...ours.r, ...add]
    .map((r, i) => ({ r, i, ts: decodeRecord(r).ts }))
    .sort((a, b) => a.ts - b.ts || a.i - b.i)
    .map((x) => x.r);
  return { value: JSON.stringify({ ...ours, r: merged }), added: add.length };
}

/**
 * Moves `bg:log:*` / `bg:rollup:*` keys from `local` into `store`.
 *
 * Crash-safe: copies are committed in ONE transaction first; only after the
 * commit resolves is each localStorage copy deleted, and only if it is still
 * byte-identical to what was copied (an older cached build in another tab may
 * have appended meanwhile; that copy is kept and merged next run). A rejected
 * commit leaves localStorage untouched.
 *
 * Idempotent: if both copies exist (a crash between commit and delete, or a
 * straggler written later by an older build) log months are merged as a union
 * by `recordIdentity`; for rollups the store's copy wins, the same rule as
 * backup import. Running it again changes nothing.
 *
 * Records the result as `Meta.logStore = 'idb'` when meta exists (no schema
 * bump). Data from a newer schema is never written to.
 */
export async function relocateLogs(local: KV, store: AsyncStore): Promise<RelocationReport> {
  const report: RelocationReport = { moved: [], merged: [], kept: [], recordsAdded: 0, skipped: null, error: null };
  const meta = readJSON<Meta>(local, KEYS.meta);
  if (meta && meta.schema > CURRENT_SCHEMA) return { ...report, skipped: 'newer-schema' };

  const ops: StoreOp[] = [];
  const toDelete: Array<{ key: string; copied: string }> = [];
  const merged: string[] = [];
  let recordsAdded = 0;
  for (const key of local.keys(NS).filter(isLogKey)) {
    const copied = local.get(key);
    if (copied === null) continue;
    let existing: string | null;
    try {
      existing = await store.get(key);
    } catch (e) {
      return { ...report, error: message(e) };
    }
    if (existing === null) {
      ops.push({ type: 'put', key, value: copied }); // verbatim: lossless even if unreadable
    } else if (key.startsWith(LOG_KEY_PREFIXES[0])) {
      const u = unionChunks(existing, copied);
      if (!u) {
        report.kept.push(key);
        continue;
      }
      if (u.value !== existing) ops.push({ type: 'put', key, value: u.value });
      merged.push(key);
      recordsAdded += u.added;
    } else {
      merged.push(key); // rollup: the store's copy wins
    }
    toDelete.push({ key, copied });
  }

  try {
    await store.batch(ops);
  } catch (e) {
    return { ...report, error: message(e) };
  }
  report.merged = merged;
  report.recordsAdded = recordsAdded;
  for (const { key, copied } of toDelete) {
    if (local.get(key) === copied) {
      local.remove(key);
      report.moved.push(key);
    } else {
      report.kept.push(key);
    }
  }

  const fresh = readJSON<Meta>(local, KEYS.meta);
  if (fresh && fresh.schema <= CURRENT_SCHEMA && fresh.logStore !== 'idb') {
    try {
      local.set(KEYS.meta, JSON.stringify({ ...fresh, logStore: 'idb' }));
    } catch {
      // localStorage full: Repo.init() records it later.
    }
  }
  return report;
}
