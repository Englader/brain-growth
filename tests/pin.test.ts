/**
 * Parent PIN (DESIGN A-30): the salted PBKDF2 record, PIN rules, the
 * grown-ups' question, the wait after wrong PINs, persistence in bg:meta with
 * no schema bump, and backups that never carry the PIN (export leaves it
 * out; import neither sets nor clears it).
 */
import { pbkdf2Sync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPin, hasPin, pinRecord, pinWait, removeParentPin, setParentPin } from '../src/app/pinActions';
import { repo, testOverrides } from '../src/app/services';
import { hashHex } from '../src/core/hash';
import { createPinRecord, FREE_TRIES, gateQuestion, isPinShape, isWeakPin, lockoutMs, PIN_ITERATIONS, verifyPin, type PinRecord } from '../src/core/pin/pin';
import { createProfile } from '../src/core/profile';
import { createRng } from '../src/core/rng';
import { MemoryKV } from '../src/data/kv';
import { Repo } from '../src/data/repo';
import { CURRENT_SCHEMA, KEYS, type Meta } from '../src/data/schema';

const T = Date.UTC(2026, 8, 27, 12);

describe('hashing and verifying', () => {
  it('stores a salted PBKDF2-SHA-256 hash, never the PIN', async () => {
    const rec = await createPinRecord('4827', T);
    expect(rec).toMatchObject({ v: 1, kdf: 'PBKDF2-SHA-256', iter: PIN_ITERATIONS, setAt: T });
    expect(rec.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rec)).not.toContain('4827');
    // The same derivation as any PBKDF2 implementation: 32 bytes of HMAC-SHA-256 over the salt.
    expect(rec.hash).toBe(pbkdf2Sync('4827', Buffer.from(rec.salt, 'hex'), rec.iter, 32, 'sha256').toString('hex'));
  });

  it('verifies the right PIN only; leading zeros count', async () => {
    const rec = await createPinRecord('0482', T, 1000);
    expect(await verifyPin('0482', rec)).toBe(true);
    expect(await verifyPin('482', rec)).toBe(false);
    expect(await verifyPin('04820', rec)).toBe(false);
    expect(await verifyPin('0483', rec)).toBe(false);
    expect(await verifyPin('', rec)).toBe(false);
  });

  it('a fresh salt every time: the same PIN never gives the same record', async () => {
    const [a, b] = await Promise.all([createPinRecord('4827', T, 1000), createPinRecord('4827', T, 1000)]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('each record keeps its own iteration count, so it can be raised later', async () => {
    const old = await createPinRecord('135790', T, 5000);
    expect(old.iter).toBe(5000);
    expect(await verifyPin('135790', old)).toBe(true);
  });

  it('rejects a PIN that is not 4 to 6 digits', async () => {
    await expect(createPinRecord('123', T)).rejects.toThrow(RangeError);
    await expect(createPinRecord('1234567', T)).rejects.toThrow(RangeError);
    await expect(createPinRecord('12a4', T)).rejects.toThrow(RangeError);
  });
});

describe('PIN rules', () => {
  it('4 to 6 digits', () => {
    expect(['0000', '4827', '48271', '482715'].every(isPinShape)).toBe(true);
    expect(['', '482', '4827150', '48 27', '48.2', '-482', '４８２７'].some(isPinShape)).toBe(false);
  });

  it('a repeated digit or a straight run is too easy to guess', () => {
    for (const p of ['0000', '1111', '1234', '4321', '0123', '987654', '345678']) expect(isWeakPin(p), p).toBe(true);
    for (const p of ['4827', '1212', '1357', '2580', '1235', '0001', '909090']) expect(isWeakPin(p), p).toBe(false);
  });
});

describe("the grown-ups' question", () => {
  it('setup: 2-digit × 2-digit (23–98 × 12–29), no multiple of 10 or 11', () => {
    const rng = createRng(1);
    for (let i = 0; i < 500; i++) {
      const q = gateQuestion(rng, 'setup');
      expect(q.answer).toBe(q.a * q.b);
      expect(q.a).toBeGreaterThanOrEqual(23);
      expect(q.a).toBeLessThanOrEqual(98);
      expect(q.b).toBeGreaterThanOrEqual(12);
      expect(q.b).toBeLessThanOrEqual(29);
      for (const n of [q.a, q.b]) expect(n % 10 === 0 || n % 11 === 0, `${q.a} × ${q.b}`).toBe(false);
    }
  });

  it('"Forgot PIN?" is harder: both factors 32–98, different, none ending in 0 or 1, no multiple of 11', () => {
    const rng = createRng(2);
    let min = Infinity;
    for (let i = 0; i < 500; i++) {
      const q = gateQuestion(rng, 'reset');
      expect(q.answer).toBe(q.a * q.b);
      expect(q.a).not.toBe(q.b);
      for (const n of [q.a, q.b]) {
        expect(n).toBeGreaterThanOrEqual(32);
        expect(n).toBeLessThanOrEqual(98);
        expect([0, 1]).not.toContain(n % 10);
        expect(n % 11).not.toBe(0);
      }
      min = Math.min(min, q.answer);
    }
    // A reset answer always has 4 digits (at least 32 · 33).
    expect(min).toBeGreaterThanOrEqual(32 * 33);
  });

  it('seeded, and a new question for every attempt', () => {
    expect(gateQuestion(createRng(7), 'setup')).toEqual(gateQuestion(createRng(7), 'setup'));
    const rng = createRng(8);
    const seen = new Set(Array.from({ length: 20 }, () => JSON.stringify(gateQuestion(rng, 'setup'))));
    expect(seen.size).toBeGreaterThan(15);
  });
});

describe('waiting after wrong PINs', () => {
  it('free for the first four, then 30 s, doubling, at most 15 min', () => {
    expect(FREE_TRIES).toBe(5);
    expect([0, 1, 2, 3, 4].map(lockoutMs)).toEqual([0, 0, 0, 0, 0]);
    expect([5, 6, 7, 8, 9].map(lockoutMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000]);
    expect(lockoutMs(10)).toBe(900_000);
    expect(lockoutMs(40)).toBe(900_000);
  });
});

describe('the PIN in bg:meta', () => {
  it('an optional field with no schema bump: old meta has none, a new one survives a reload', async () => {
    expect(CURRENT_SCHEMA).toBe(1);
    const kv = new MemoryKV();
    const old = { schema: 1, deviceId: 'd', profileIds: [], activeProfileId: null, createdAt: T, lastBackupAt: null, deviceFlags: {}, adultSeen: false };
    kv.set(KEYS.meta, JSON.stringify(old));
    const r = new Repo(kv, () => T);
    expect(r.init().ran).toEqual([]);
    expect(r.meta().parentPin).toBeUndefined();

    const rec = await createPinRecord('4827', T, 1000);
    r.saveMeta({ parentPin: rec });
    const reloaded = new Repo(kv, () => T);
    reloaded.init();
    expect(reloaded.meta().parentPin).toEqual(rec);
    expect(reloaded.readOnly).toBe(false);
    // Removing it leaves no trace in the stored JSON.
    reloaded.saveMeta({ parentPin: undefined });
    expect(kv.get(KEYS.meta)).not.toContain('parentPin');
  });
});

describe('backups never carry the PIN', () => {
  const device = (pin: PinRecord | null): Repo => {
    const r = new Repo(new MemoryKV(), () => T);
    r.init();
    r.saveProfile(createProfile({ name: 'Ана', age: 6, locale: 'mk', avatar: 'color.green' }, T));
    if (pin) r.saveMeta({ parentPin: pin });
    return r;
  };
  /** A backup file whose meta carries `pin` (as a hand-edited or foreign file could), with a valid checksum. */
  const fileWith = (from: Repo, pin: PinRecord | null): string => {
    const f = from.exportBackup();
    const meta = JSON.parse(f.entries[KEYS.meta]!) as Meta;
    f.entries[KEYS.meta] = JSON.stringify(pin ? { ...meta, parentPin: pin } : meta);
    return JSON.stringify({ ...f, checksum: hashHex(JSON.stringify(f.entries)) });
  };

  it('export leaves the PIN out of the file', async () => {
    const rec = await createPinRecord('4827', T, 1000);
    const r = device(rec);
    const text = JSON.stringify(r.exportBackup());
    expect(text).not.toContain(rec.hash);
    expect(text).not.toContain(rec.salt);
    expect(text).not.toContain('parentPin');
    const f = JSON.parse(text) as { entries: Record<string, string>; checksum: string };
    expect(JSON.parse(f.entries[KEYS.meta]!).profileIds).toHaveLength(1);
    expect(hashHex(JSON.stringify(f.entries))).toBe(f.checksum);
    // Exporting does not touch the device's own PIN.
    expect(r.meta().parentPin).toEqual(rec);
  });

  it('import neither overwrites nor clears the PIN', async () => {
    const mine = await createPinRecord('4827', T, 1000);
    const theirs = await createPinRecord('1357', T, 1000);
    const r = device(mine);
    expect(r.importBackup(fileWith(device(null), theirs)).ok).toBe(true);
    expect(r.meta().parentPin).toEqual(mine);
    expect(r.importBackup(fileWith(device(null), null)).ok).toBe(true);
    expect(r.meta().parentPin).toEqual(mine);
    // A device without a PIN does not get one from a file.
    const bare = device(null);
    expect(bare.importBackup(fileWith(device(null), theirs)).ok).toBe(true);
    expect(bare.meta().parentPin).toBeUndefined();
  });
});

describe('pin actions', () => {
  beforeEach(() => {
    repo.init();
    removeParentPin();
    testOverrides.clockOffsetMs = 0;
  });
  afterEach(() => {
    testOverrides.clockOffsetMs = 0;
  });

  it('set, check, reset through "Forgot PIN?", remove', async () => {
    expect(hasPin()).toBe(false);
    await setParentPin('4827', 'setup');
    expect(hasPin()).toBe(true);
    expect(pinRecord()?.resetAt).toBeUndefined();
    expect(await checkPin('4827')).toEqual({ ok: true });
    expect((await checkPin('4828')).ok).toBe(false);
    await setParentPin('2580', 'reset');
    expect(pinRecord()?.resetAt).toBe(pinRecord()?.setAt);
    expect((await checkPin('4827')).ok).toBe(false);
    expect(await checkPin('2580')).toEqual({ ok: true });
    removeParentPin();
    expect(hasPin()).toBe(false);
    expect(repo.meta().parentPin).toBeUndefined();
  });

  it('after five wrong PINs in a row it waits, even for the right one; the wait grows and is stored', async () => {
    await setParentPin('4827', 'setup');
    for (let i = 1; i < FREE_TRIES; i++) expect(await checkPin('1111')).toEqual({ ok: false, waitMs: 0 });
    expect(await checkPin('1111')).toEqual({ ok: false, waitMs: 30_000 });
    // Stored in meta, so a reload still waits.
    expect(repo.meta().parentPin).toMatchObject({ fails: 5 });
    expect(pinWait()).toBeGreaterThan(29_000);
    const during = await checkPin('4827');
    expect(during.ok).toBe(false);
    testOverrides.clockOffsetMs = 31_000;
    expect(pinWait()).toBe(0);
    expect(await checkPin('9999')).toEqual({ ok: false, waitMs: 60_000 });
    testOverrides.clockOffsetMs = 31_000 + 61_000;
    expect(await checkPin('4827')).toEqual({ ok: true });
    expect(pinRecord()).toMatchObject({ fails: 0, waitUntil: 0 });
    // The count starts again from zero.
    expect(await checkPin('1111')).toEqual({ ok: false, waitMs: 0 });
  });

  it('a new PIN clears the wait', async () => {
    await setParentPin('4827', 'setup');
    for (let i = 0; i < FREE_TRIES; i++) await checkPin('1111');
    expect(pinWait()).toBeGreaterThan(0);
    await setParentPin('2580', 'reset');
    expect(pinWait()).toBe(0);
    expect(await checkPin('2580')).toEqual({ ok: true });
  });
});
