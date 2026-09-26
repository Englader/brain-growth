/**
 * Storage schema v1. Keys:
 *
 *   bg:meta                         Meta (schema version, profile list, device settings)
 *   bg:profile:<pid>                Profile JSON
 *   bg:log:<pid>:<YYYY-MM>          { v: 1, r: EncodedRecord[] }  append-only month chunk
 *   bg:rollup:<pid>:<YYYY-MM>       Rollup (compacted month; raw chunk removed)
 *   bg:rivals                       Record<pid, RivalCard> imported via share links
 *   bg:backup:pre-v<N>              safety snapshot taken before migrating from N
 */
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
  /** Hold-to-open adult gate completed on this device (not a security boundary). */
  adultSeen: boolean;
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
