/**
 * Recorded voice clips on disk: public/audio/<locale>/<clip-id>.mp3. Shared by
 * `npm run gen:clips` (writes src/audio/clips.manifest.json, which the app
 * reads) and tests/audio.test.ts (checks the committed manifest and every file).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { requiredClips } from '../src/audio/voiceScript';
import { allLocales } from '../src/i18n/locales';

export const AUDIO_DIR = 'public/audio';
export const CLIP_MANIFEST = 'src/audio/clips.manifest.json';
/** ~48 kbps mono: even a long phrase stays far below this; anything bigger is the wrong export settings. */
export const MAX_CLIP_BYTES = 150 * 1024;

/** Clip ids per locale id. */
export type ClipManifest = Record<string, string[]>;

const ROOT = resolve(__dirname, '..');

const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.') && statSync(join(dir, f)).isFile()) : []);

/** The .mp3 files in public/audio/<locale>/ for every locale, sorted. A missing folder is an empty list (a fresh clone has none). */
export function scanClips(root = ROOT): ClipManifest {
  const out: ClipManifest = {};
  for (const loc of allLocales()) {
    out[loc.id] = files(join(root, AUDIO_DIR, loc.id))
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => f.slice(0, -'.mp3'.length))
      .sort();
  }
  return out;
}

/** The manifest file's exact text (the build and the test must agree byte for byte). */
export function renderManifest(m: ClipManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}

/** Why a clip file cannot be played: empty, too large, or not MP3 (neither an ID3v2 tag nor an MPEG frame sync). */
export function clipFileProblem(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return 'empty file';
  if (bytes.length > MAX_CLIP_BYTES) return `${Math.ceil(bytes.length / 1024)} KB (limit ${MAX_CLIP_BYTES / 1024} KB)`;
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const sync = bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0;
  return id3 || sync ? null : 'not an MP3 (no ID3 tag or MPEG frame header)';
}

/**
 * Every problem with the files under public/audio/: a clip id no voice line
 * uses (a typo such as num.07.mp3 would never play), a file that is not
 * `.mp3`, a folder that is not a locale, and unplayable files.
 */
export function clipProblems(root = ROOT): string[] {
  const out: string[] = [];
  const base = join(root, AUDIO_DIR);
  const locales = new Set(allLocales().map((l) => l.id));
  if (existsSync(base)) {
    for (const name of readdirSync(base)) if (!name.startsWith('.') && !locales.has(name)) out.push(`${AUDIO_DIR}/${name}: not a locale folder (${[...locales].join(', ')})`);
  }
  for (const loc of allLocales()) {
    const dir = join(base, loc.id);
    const needed = new Set(requiredClips(loc.id));
    for (const f of files(dir)) {
      const path = `${AUDIO_DIR}/${loc.id}/${f}`;
      if (!f.endsWith('.mp3')) {
        out.push(`${path}: not an .mp3 file`);
        continue;
      }
      if (!needed.has(f.slice(0, -'.mp3'.length))) out.push(`${path}: no voice line uses this clip id (see design/audio-recording-script.md)`);
      const problem = clipFileProblem(readFileSync(join(dir, f)));
      if (problem) out.push(`${path}: ${problem}`);
    }
  }
  return out;
}
