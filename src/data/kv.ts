/**
 * Key-value storage adapter. Everything persistent goes through this, so the
 * backing store can change (IndexedDB for the log, a sync backend one day)
 * without touching callers. All keys live under the `bg:` namespace because
 * GitHub Pages serves every project of a user from ONE origin
 * (username.github.io) — localStorage is shared with every other project there.
 */
export const NS = 'bg:';

export class StorageFullError extends Error {
  constructor(readonly key: string) {
    super(`storage full while writing ${key}`);
  }
}

export interface KV {
  get(key: string): string | null;
  /** Throws StorageFullError when the quota is exceeded. */
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Keys (full, including NS) that start with `prefix`. */
  keys(prefix?: string): string[];
  /** Approximate bytes used by our namespace (UTF-16: 2 bytes per char). */
  bytesUsed(): number;

  // Optional members, implemented only by a KV that keeps log months in a
  // second, asynchronous store (HybridKV). Plain KVs leave them out and keep
  // today's single-store behaviour.
  /** Where log months live; Repo.init() records it as Meta.logStore. */
  readonly logStore?: 'idb';
  /** Bytes held by the log store (same UTF-16 measure as bytesUsed()). */
  idbBytes?(): number;
  /** Per-store compaction budget for log months; replaces the localStorage soft budget. */
  logsOverBudget?(): boolean;
  /** Resolves once every accepted write has been committed to durable storage. */
  flush?(): Promise<void>;
}

/** Quota errors from localStorage and IndexedDB (browser-specific codes and names). */
export function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.code === 22 || e.code === 1014 || e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

export class LocalStorageKV implements KV {
  constructor(private readonly ls: Storage = window.localStorage) {}

  get(key: string): string | null {
    return this.ls.getItem(key);
  }

  set(key: string, value: string): void {
    try {
      this.ls.setItem(key, value);
    } catch (e) {
      if (isQuotaError(e)) throw new StorageFullError(key);
      throw e;
    }
  }

  remove(key: string): void {
    this.ls.removeItem(key);
  }

  keys(prefix = NS): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.ls.length; i++) {
      const k = this.ls.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out.sort();
  }

  bytesUsed(): number {
    return this.keys().reduce((n, k) => n + 2 * (k.length + (this.ls.getItem(k)?.length ?? 0)), 0);
  }
}

/** In-memory KV (tests, backup processing). Optional quota in bytes to exercise full-storage paths. */
export class MemoryKV implements KV {
  readonly map = new Map<string, string>();
  constructor(private readonly quotaBytes = Infinity) {}

  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  set(key: string, value: string): void {
    const prev = this.map.get(key);
    const delta = 2 * (value.length - (prev?.length ?? -key.length));
    if (this.bytesUsed() + delta > this.quotaBytes) throw new StorageFullError(key);
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }

  keys(prefix = NS): string[] {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  bytesUsed(): number {
    let n = 0;
    for (const [k, v] of this.map) if (k.startsWith(NS)) n += 2 * (k.length + v.length);
    return n;
  }
}

export function readJSON<T>(kv: KV, key: string): T | null {
  const raw = kv.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
