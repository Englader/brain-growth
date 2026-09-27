/**
 * Parent PIN actions (DESIGN A-30). The record lives in `Meta.parentPin`
 * (bg:meta): a salted PBKDF2 hash, never the PIN, never logged, left out of
 * backups. Wrong PINs are counted in the record, so the wait after the fifth
 * one survives a reload (and, in memory, a read-only second tab).
 */
import { createPinRecord, lockoutMs, verifyPin, waitLeft, type PinRecord } from '../core/pin/pin';
import { unlockAdult } from './adultLock';
import { now, repo } from './services';
import { setState } from './store';

export function pinRecord(): PinRecord | null {
  return repo.meta().parentPin ?? null;
}

export function hasPin(): boolean {
  return pinRecord() !== null;
}

/** Wrong tries this page has seen, so a read-only tab (whose meta writes are dropped) still waits. */
let memory: { fails: number; waitUntil: number } = { fails: 0, waitUntil: 0 };

function saveRecord(rec: PinRecord | undefined): void {
  setState({ meta: repo.saveMeta({ parentPin: rec }) });
}

/** Milliseconds before the next PIN may be checked (0: now). */
export function pinWait(): number {
  return Math.max(waitLeft(pinRecord(), now()), waitLeft(memory, now()));
}

/** Choose a new PIN: at setup, as a change (the current one entered first) or through "Forgot PIN?" (`reset`). */
export async function setParentPin(pin: string, how: 'setup' | 'change' | 'reset'): Promise<void> {
  const rec = await createPinRecord(pin, now());
  memory = { fails: 0, waitUntil: 0 };
  saveRecord(how === 'reset' ? { ...rec, resetAt: rec.setAt } : rec);
}

/** Remove the PIN: the next visit to the Grown-ups area asks to set one again. */
export function removeParentPin(): void {
  memory = { fails: 0, waitUntil: 0 };
  saveRecord(undefined);
}

export type PinCheck = { ok: true } | { ok: false; waitMs: number };

/**
 * Check a PIN against the record. A wrong one counts; from the fifth in a row
 * each is followed by a wait (30 s, doubling, at most 15 min), during which
 * nothing is checked, not even the right PIN. The right one clears the count.
 */
export async function checkPin(pin: string): Promise<PinCheck> {
  const before = pinRecord();
  if (!before) return { ok: false, waitMs: 0 };
  const wait = pinWait();
  if (wait > 0) return { ok: false, waitMs: wait };
  const ok = await verifyPin(pin, before);
  // Re-read after the await: the record may have changed meanwhile.
  const rec = pinRecord();
  if (!rec || rec.hash !== before.hash) return { ok: false, waitMs: 0 };
  if (ok) {
    memory = { fails: 0, waitUntil: 0 };
    if (rec.fails || rec.waitUntil) saveRecord({ ...rec, fails: 0, waitUntil: 0 });
    return { ok: true };
  }
  const fails = Math.max(rec.fails ?? 0, memory.fails) + 1;
  const waitMs = lockoutMs(fails);
  const waitUntil = waitMs ? now() + waitMs : 0;
  memory = { fails, waitUntil };
  saveRecord({ ...rec, fails, waitUntil });
  return { ok: false, waitMs };
}

/** Enter the Grown-ups area with the PIN. */
export async function unlockWithPin(pin: string): Promise<PinCheck> {
  const r = await checkPin(pin);
  if (r.ok) unlockAdult();
  return r;
}
