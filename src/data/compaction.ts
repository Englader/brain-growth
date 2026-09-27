/**
 * Log compaction. Raw item records are the richest data we have, so they are
 * kept as long as storage allows. When the namespace nears its budget, the
 * oldest raw months are rolled up into per-day-per-skill aggregates (enough
 * for trends, calibration and mastery-over-time charts) and the raw chunk is
 * removed. Events are small and kept verbatim.
 */
import { decodeRecord, encodeRecord } from '../core/log/codec';
import type { EventRecord } from '../core/log/types';
import { dayKey } from '../core/time';
import { readJSON, type KV } from './kv';
import { KEYS, type LogChunk } from './schema';

/** Soft budget: compact above this, leaving headroom below the ~5 MB origin quota. */
export const SOFT_BUDGET_BYTES = 3_500_000;
/** Never compact the most recent months. */
export const KEEP_RAW_MONTHS = 3;
/** IndexedDB log store: compact only above this many bytes (UTF-16 measure) … */
export const IDB_BUDGET_BYTES = 50_000_000;
/** … or when the origin's storage estimate reports more than this share of its quota used. */
export const IDB_MAX_QUOTA_SHARE = 0.5;

/** Shape of `navigator.storage.estimate()`. */
export interface StorageEstimateLike {
  usage?: number;
  quota?: number;
}

/** Budget for log months kept in IndexedDB. Raw history is kept long-term. */
export function idbOverBudget(idbBytes: number, estimate?: StorageEstimateLike | null): boolean {
  if (idbBytes > IDB_BUDGET_BYTES) return true;
  const { usage, quota } = estimate ?? {};
  return typeof usage === 'number' && typeof quota === 'number' && quota > 0 && usage / quota > IDB_MAX_QUOTA_SHARE;
}

/** Per-store budget: a KV with its own log store says so; otherwise the localStorage soft budget applies. */
export function logsOverBudget(kv: KV): boolean {
  return kv.logsOverBudget ? kv.logsOverBudget() : kv.bytesUsed() >= SOFT_BUDGET_BYTES;
}

export interface SkillDayAgg {
  first: number;
  firstCorrect: number;
  attempts: number;
  sumP: number;
  sumLatency: number;
}

export interface Rollup {
  v: 1;
  month: string;
  /** day → skill → aggregate */
  days: Record<string, Record<string, SkillDayAgg>>;
  /** day → { sessions, durationMs } */
  sessions: Record<string, { n: number; durationMs: number }>;
  misconceptions: Record<string, number>;
  events: unknown[];
}

export function rollupChunk(month: string, chunk: LogChunk): Rollup {
  const out: Rollup = { v: 1, month, days: {}, sessions: {}, misconceptions: {}, events: [] };
  for (const raw of chunk.r) {
    const r = decodeRecord(raw);
    if (r.type === 'item') {
      const d = dayKey(r.ts);
      const day = (out.days[d] ??= {});
      const a = (day[r.skill] ??= { first: 0, firstCorrect: 0, attempts: 0, sumP: 0, sumLatency: 0 });
      a.attempts++;
      if (r.attempt === 1) {
        a.first++;
        a.firstCorrect += r.correct ? 1 : 0;
        a.sumP += r.p;
        a.sumLatency += r.latency;
      }
      if (r.mis) out.misconceptions[r.mis] = (out.misconceptions[r.mis] ?? 0) + 1;
    } else if (r.type === 'session' && r.phase === 'end') {
      const d = dayKey(r.ts);
      const s = (out.sessions[d] ??= { n: 0, durationMs: 0 });
      s.n++;
      s.durationMs += r.durationMs ?? 0;
    } else if (r.type === 'event') {
      out.events.push(encodeRecord(r as EventRecord));
    } else if (r.type === 'unknown') {
      out.events.push(raw);
    }
  }
  return out;
}

export function compactMonth(kv: KV, pid: string, month: string): boolean {
  const chunk = readJSON<LogChunk>(kv, KEYS.log(pid, month));
  if (!chunk) return false;
  const roll = rollupChunk(month, chunk);
  kv.set(KEYS.rollup(pid, month), JSON.stringify(roll));
  kv.remove(KEYS.log(pid, month));
  return true;
}

/**
 * Compact oldest raw months across all profiles until under budget.
 * `force` ignores the soft budget (used after a quota error). A quota error
 * can only come from localStorage, so when log months live in their own store
 * forcing would destroy raw history without freeing any room: it is ignored.
 */
export function compactIfNeeded(kv: KV, currentMonth: string, force = false): string[] {
  if (kv.logsOverBudget) force = false;
  const done: string[] = [];
  const rawKeys = kv
    .keys(`bg:log:`)
    .map((k) => {
      const [, , pid, month] = k.split(':');
      return { k, pid: pid!, month: month! };
    })
    .filter((x) => monthsBetween(x.month, currentMonth) >= KEEP_RAW_MONTHS)
    .sort((a, b) => a.month.localeCompare(b.month));
  for (const x of rawKeys) {
    if (!force && !logsOverBudget(kv)) break;
    if (compactMonth(kv, x.pid, x.month)) done.push(`${x.pid}:${x.month}`);
    force = false;
  }
  return done;
}

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number) as [number, number];
  const [yb, mb] = b.split('-').map(Number) as [number, number];
  return (yb - ya) * 12 + (mb - ma);
}
