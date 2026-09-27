/**
 * Parent PIN (DESIGN A-30): the lock in front of the Grown-ups area. Pure
 * functions only; src/app/pinActions.ts stores the record and
 * src/app/adultLock.ts keeps the area open or locked.
 *
 * A lock against children, not strong security. Everything lives on this
 * device, so anyone who can read the browser's storage can get around it, and
 * a 4–6 digit PIN has at most 1 111 000 values: trying them all against the
 * stored hash takes a computer minutes, whatever the iteration count. The
 * salted PBKDF2 hash only keeps the digits themselves out of storage, out of
 * backups and away from a glance at developer tools.
 */
import type { Rng } from '../rng';

export const PIN_MIN = 4;
export const PIN_MAX = 6;

/** PBKDF2-SHA-256 iterations for new records (each record keeps its own count, so this can be raised later). */
export const PIN_ITERATIONS = 210_000;

/** Wrong PINs in a row that are free; from the next one on, each is followed by a wait (lockoutMs). */
export const FREE_TRIES = 5;
const FIRST_WAIT_MS = 30_000;
const MAX_WAIT_MS = 15 * 60_000;

/**
 * Stored in `Meta.parentPin` (bg:meta; optional field, no schema bump). Never
 * holds the PIN. Left out of backup files, and import never writes it.
 */
export interface PinRecord {
  v: 1;
  kdf: 'PBKDF2-SHA-256';
  iter: number;
  /** 16 random bytes, hex. */
  salt: string;
  /** 32 derived bytes, hex. */
  hash: string;
  /** When this PIN was chosen (setup, change or reset). */
  setAt: number;
  /** Set when the PIN was chosen through "Forgot PIN?", so the grown-ups can see it happened. */
  resetAt?: number;
  /** Wrong PINs in a row (reset by the right one or a new PIN). */
  fails?: number;
  /** No PIN is checked before this time (app clock, ms). */
  waitUntil?: number;
}

/** 4 to 6 digits. Leading zeros count: 0123 and 123 are different PINs. */
export function isPinShape(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

/** One digit repeated (0000) or a straight run up or down (1234, 987654): the first things a child tries. */
export function isWeakPin(pin: string): boolean {
  const d = [...pin].map(Number);
  const step = d[1]! - d[0]!;
  return Math.abs(step) <= 1 && d.every((x, i) => i === 0 || x - d[i - 1]! === step);
}

/** How long to wait after `fails` wrong PINs in a row: nothing for the first FREE_TRIES − 1, then 30 s, doubling, at most 15 min. */
export function lockoutMs(fails: number): number {
  if (fails < FREE_TRIES) return 0;
  return Math.min(FIRST_WAIT_MS * 2 ** (fails - FREE_TRIES), MAX_WAIT_MS);
}

/** Time left before the next PIN may be checked (0 when it may be checked now). */
export function waitLeft(rec: Pick<PinRecord, 'waitUntil'> | null | undefined, now: number): number {
  return rec?.waitUntil ? Math.max(0, rec.waitUntil - now) : 0;
}

// ── hashing (WebCrypto) ──────────────────────────────────────────────────

/** WebCrypto is there (a secure page: https or localhost). Without it no PIN can be set or checked. */
export function canHashPins(): boolean {
  return typeof globalThis.crypto?.subtle?.deriveBits === 'function';
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string): Uint8Array => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

async function derive(pin: string, salt: Uint8Array, iter: number): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256);
  return toHex(new Uint8Array(bits));
}

/** A new record for `pin` with a fresh random salt. Rejects a PIN that is not 4–6 digits. */
export async function createPinRecord(pin: string, now: number, iter = PIN_ITERATIONS): Promise<PinRecord> {
  if (!isPinShape(pin)) throw new RangeError('PIN must be 4 to 6 digits');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, kdf: 'PBKDF2-SHA-256', iter, salt: toHex(salt), hash: await derive(pin, salt, iter), setAt: now };
}

/** Does `pin` match the record? Compares every character (no early exit). */
export async function verifyPin(pin: string, rec: PinRecord): Promise<boolean> {
  if (!isPinShape(pin)) return false;
  const got = await derive(pin, fromHex(rec.salt), rec.iter);
  if (got.length !== rec.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return diff === 0;
}

// ── the grown-ups' question ──────────────────────────────────────────────

/**
 * 'setup': before the first PIN is set, so a young child cannot claim it
 * (e.g. 37 × 24). 'reset': "Forgot PIN?", harder (e.g. 67 × 48).
 */
export type GateKind = 'setup' | 'reset';

export interface GateQuestion {
  a: number;
  b: number;
  answer: number;
}

/** Two-digit factors without a shortcut: no multiple of 10 or 11; for 'reset' no factor ending in 1 either. */
const plain = (n: number, kind: GateKind): boolean => n % 10 !== 0 && n % 11 !== 0 && (kind === 'setup' || n % 10 !== 1);

/**
 * A multiplication a grown-up can do and a young child cannot: 2-digit × 2-digit.
 * 'setup': 23–98 × 12–29 (a 3–4 digit answer); 'reset': both factors 32–98 and
 * different, so both partial products carry. A new question for every attempt.
 */
export function gateQuestion(rng: Rng, kind: GateKind): GateQuestion {
  const pick = (lo: number, hi: number): number => {
    for (;;) {
      const n = rng.int(lo, hi);
      if (plain(n, kind)) return n;
    }
  };
  const a = kind === 'setup' ? pick(23, 98) : pick(32, 98);
  let b = kind === 'setup' ? pick(12, 29) : pick(32, 98);
  while (kind === 'reset' && b === a) b = pick(32, 98);
  return { a, b, answer: a * b };
}
