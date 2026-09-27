/**
 * On-disk log encoding: positional arrays, versioned per record type.
 *
 *   ['i', 1, ts, sid, key, skill, …]     item record, version 1
 *   ['s', 1, ts, sid, phase, …]          session record
 *   ['e', 1, ts, sid, name, data]        event record
 *
 * ~55% smaller than keyed JSON (localStorage is ~5 MB per ORIGIN). Rules for
 * forward compatibility:
 *  - Appending a field at the END of a field list does not bump the version;
 *    older readers ignore extras, newer readers default missing tail fields.
 *  - Any change of meaning bumps the version and adds an upgrade function.
 *  - Records this build cannot decode (unknown tag or newer version) decode to
 *    `UnknownRecord` and are preserved verbatim; nothing is ever dropped.
 */
import type { AnyRecord, EventRecord, ItemRecord, LogRecord, SessionRecord } from './types';

type Encoded = unknown[];

const ITEM_FIELDS_V1 = [
  'ts', 'sid', 'key', 'skill', 'gen', 'genV', 'seed', 'level', 'diff', 'p', 'mu', 's2',
  'correct', 'attempt', 'latency', 'hint', 'answer', 'expected', 'mis', 'mode', 'band',
  'locale', 'source', 'timed', 'input', 'hops', 'alt',
  // Appended (no version bump): older records decode with tier = null.
  'tier',
  // Appended (no version bump): older records decode with revealed, ladder and req = null (log/help.ts).
  'revealed', 'ladder', 'req',
] as const;
const SESSION_FIELDS_V1 = [
  'ts', 'sid', 'phase', 'mode', 'band', 'locale', 'opts', 'items', 'firstCorrect', 'durationMs', 'completed',
  'lastCorrect', 'exitIndex',
  // Appended (no version bump): the school year browsed (DESIGN A-29); older records decode with year = null.
  'year',
] as const;
const EVENT_FIELDS_V1 = ['ts', 'sid', 'name', 'data'] as const;

const BOOL_FIELDS = new Set(['correct', 'hint', 'timed', 'alt', 'completed', 'lastCorrect', 'revealed']);

interface TypeCodec {
  tag: string;
  type: LogRecord['type'];
  version: number;
  fields: Record<number, readonly string[]>;
  /** Upgrade a decoded older-version object to the current shape. */
  upgrade: Record<number, (o: Record<string, unknown>) => Record<string, unknown>>;
}

const CODECS: TypeCodec[] = [
  { tag: 'i', type: 'item', version: 1, fields: { 1: ITEM_FIELDS_V1 }, upgrade: {} },
  { tag: 's', type: 'session', version: 1, fields: { 1: SESSION_FIELDS_V1 }, upgrade: {} },
  { tag: 'e', type: 'event', version: 1, fields: { 1: EVENT_FIELDS_V1 }, upgrade: {} },
];

const byType = new Map(CODECS.map((c) => [c.type, c]));
const byTag = new Map(CODECS.map((c) => [c.tag, c]));

export function encodeRecord(r: LogRecord): Encoded {
  const c = byType.get(r.type)!;
  const fields = c.fields[c.version]!;
  const o = r as unknown as Record<string, unknown>;
  return [c.tag, c.version, ...fields.map((f) => (BOOL_FIELDS.has(f) ? (o[f] === null || o[f] === undefined ? null : o[f] ? 1 : 0) : o[f] ?? null))];
}

export function decodeRecord(arr: unknown): AnyRecord {
  if (!Array.isArray(arr) || arr.length < 3) return { type: 'unknown', ts: 0, raw: arr };
  const [tag, version] = arr as [unknown, unknown];
  const c = typeof tag === 'string' ? byTag.get(tag) : undefined;
  const ts = typeof arr[2] === 'number' ? arr[2] : 0;
  if (!c || typeof version !== 'number' || version > c.version || !c.fields[version]) {
    return { type: 'unknown', ts, raw: arr };
  }
  const fields = c.fields[version]!;
  let o: Record<string, unknown> = { type: c.type };
  fields.forEach((f, i) => {
    const v = arr[i + 2];
    o[f] = BOOL_FIELDS.has(f) ? (v === null || v === undefined ? null : v === 1 || v === true) : v ?? null;
  });
  for (let v = version; v < c.version; v++) o = c.upgrade[v]!(o);
  return o as unknown as LogRecord;
}

/** Stable identity used to de-duplicate records when merging backups. */
export function recordIdentity(arr: unknown): string {
  if (!Array.isArray(arr)) return JSON.stringify(arr);
  const r = decodeRecord(arr);
  switch (r.type) {
    case 'item':
      return `i|${r.ts}|${r.sid}|${r.key}|${r.attempt}`;
    case 'session':
      return `s|${r.ts}|${r.sid}|${r.phase}`;
    case 'event':
      return `e|${r.ts}|${r.sid}|${r.name}`;
    default:
      return `u|${JSON.stringify(arr)}`;
  }
}

export type { ItemRecord, SessionRecord, EventRecord };
