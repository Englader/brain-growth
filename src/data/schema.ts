/**
 * Storage schema v1. Keys:
 *
 *   bg:meta                         Meta (schema version, profile list, device settings)
 *   bg:profile:<pid>                Profile JSON
 *   bg:log:<pid>:<YYYY-MM>          { v: 1, r: EncodedRecord[] }  append-only month chunk
 *   bg:rollup:<pid>:<YYYY-MM>       Rollup (compacted month; raw chunk removed)
 *   bg:rivals                       Record<pid, RivalCard> imported via share links
 *   bg:backup:pre-v<N>              safety snapshot taken before migrating from N
 *
 * With Meta.logStore = 'idb' the bg:log:* and bg:rollup:* keys live in
 * IndexedDB (data/idb.ts) behind the same KV interface (data/hybridKV.ts);
 * everything else stays in localStorage.
 */
import type { PinRecord } from '../core/pin/pin';
import { NS } from './kv';

export const CURRENT_SCHEMA = 1;

export interface Meta {
  schema: number;
  deviceId: string;
  profileIds: string[];
  activeProfileId: string | null;
  createdAt: number;
  lastBackupAt: number | null;
  deviceFlags: Record<string, boolean>;
  /** Legacy: set by nothing since the parent PIN replaced the 2-second hold (DESIGN A-30); kept for old builds. */
  adultSeen: boolean;
  /** Language for screens shown before a player is chosen (additive field, optional). */
  uiLocale?: string;
  /**
   * 'idb' once log months (bg:log:*, bg:rollup:*) have moved to IndexedDB
   * (additive field, optional; deliberately NO schema bump: a bump would put an
   * older cached build into read-only mode mid-play). Absent = localStorage.
   */
  logStore?: 'idb';
  /**
   * The parent PIN in front of the Grown-ups area (DESIGN A-30): a salted
   * PBKDF2 hash, never the PIN (additive field, optional; no schema bump, as
   * for logStore). Absent = no PIN yet: the next visit sets one. Device-level
   * only: backup export leaves it out and import never writes it.
   */
  parentPin?: PinRecord;
}

export const KEYS = {
  meta: `${NS}meta`,
  profile: (pid: string) => `${NS}profile:${pid}`,
  profilePrefix: `${NS}profile:`,
  log: (pid: string, month: string) => `${NS}log:${pid}:${month}`,
  logPrefix: (pid: string) => `${NS}log:${pid}:`,
  rollup: (pid: string, month: string) => `${NS}rollup:${pid}:${month}`,
  rollupPrefix: (pid: string) => `${NS}rollup:${pid}:`,
  rivals: `${NS}rivals`,
  backupPrefix: `${NS}backup:`,
  backup: (fromSchema: number) => `${NS}backup:pre-v${fromSchema}`,
} as const;

export interface LogChunk {
  v: 1;
  r: unknown[];
}
