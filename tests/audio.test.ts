import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AUDIO_DIR, CLIP_MANIFEST, clipFileProblem, clipProblems, MAX_CLIP_BYTES, renderManifest, scanClips } from '../scripts/clips';
import { hasClip, missingClips, RECORDED_CLIPS } from '../src/audio/clips';
import { allVoiceKeys, numberClips, requiredClips } from '../src/audio/voiceScript';
import { allLocales } from '../src/i18n/locales';

describe('voice script', () => {
  it('composes numbers per locale (Macedonian joins tens and units with "и")', () => {
    expect(numberClips(7, 'mk')).toEqual(['num.7']);
    expect(numberClips(40, 'en')).toEqual(['num.40']);
    expect(numberClips(47, 'mk')).toEqual(['num.40', 'word.and', 'num.7']);
    expect(numberClips(47, 'en')).toEqual(['num.40', 'num.7']);
    expect(numberClips(101, 'en')).toBeNull();
  });

  it('every clip needed by a locale has recordable text in that locale', () => {
    for (const loc of allLocales()) {
      for (const id of requiredClips(loc.id)) {
        const key = id.startsWith('voice.') ? id : `clip.${id}`;
        expect(loc.messages[key], `${loc.id}:${key}`).toBeTruthy();
      }
    }
  });

  it('every voice line key exists as a message (TTS fallback text)', () => {
    for (const loc of allLocales()) for (const k of allVoiceKeys()) expect(loc.messages[k], `${loc.id}:${k}`).toBeTruthy();
  });

  it('recording budget stays small (under 140 clips per locale; A-15 expects ~130 by v1)', () => {
    for (const loc of allLocales()) expect(requiredClips(loc.id).length).toBeLessThan(140);
  });
});

describe('drop-in recordings (public/audio/<locale>/*.mp3 → clips.manifest.json)', () => {
  const ROOT = resolve(__dirname, '..');

  it('the committed manifest equals the folder listing (stale: run npm run gen:clips)', () => {
    const listing = scanClips();
    expect(readFileSync(resolve(ROOT, CLIP_MANIFEST), 'utf8') === renderManifest(listing), 'stale: run npm run gen:clips').toBe(true);
    expect(RECORDED_CLIPS).toEqual(listing);
    expect(Object.keys(listing)).toEqual(allLocales().map((l) => l.id));
  });

  it('every recorded file is a clip a voice line needs, non-empty, under 150 KB, with an MP3 or ID3 signature', () => {
    for (const loc of allLocales()) {
      const needed = new Set(requiredClips(loc.id));
      for (const id of scanClips()[loc.id] ?? []) {
        expect(needed.has(id), `${AUDIO_DIR}/${loc.id}/${id}.mp3 is not in requiredClips('${loc.id}')`).toBe(true);
        expect(clipFileProblem(readFileSync(resolve(ROOT, AUDIO_DIR, loc.id, `${id}.mp3`))), `${loc.id}/${id}.mp3`).toBeNull();
      }
    }
    expect(clipProblems()).toEqual([]);
  });

  it('the missing list is the recording checklist: required minus recorded', () => {
    for (const loc of allLocales()) {
      const missing = missingClips(loc.id);
      expect(missing.length + requiredClips(loc.id).filter((id) => hasClip(loc.id, id)).length).toBe(requiredClips(loc.id).length);
      for (const id of missing) expect(hasClip(loc.id, id)).toBe(false);
    }
  });

  describe('the checks themselves (a scratch folder)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hopa-clips-'));
    afterAll(() => rmSync(tmp, { recursive: true, force: true }));
    const put = (rel: string, bytes: number[] | Uint8Array): void => {
      mkdirSync(join(tmp, rel, '..'), { recursive: true });
      writeFileSync(join(tmp, rel), Uint8Array.from(bytes));
    };
    const id3 = [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0];
    const frame = [0xff, 0xfb, 0x90, 0x64];

    it('a fresh clone without public/audio lists no clips and has no problems', () => {
      expect(scanClips(tmp)).toEqual(Object.fromEntries(allLocales().map((l) => [l.id, []])));
      expect(clipProblems(tmp)).toEqual([]);
    });

    it('lists .mp3 files by id and reports typos, wrong formats, empty and oversized files', () => {
      put(`${AUDIO_DIR}/mk/num.7.mp3`, id3);
      put(`${AUDIO_DIR}/mk/word.plus.mp3`, frame);
      put(`${AUDIO_DIR}/mk/num.07.mp3`, id3);
      put(`${AUDIO_DIR}/mk/voice.welcome.mp3`, []);
      put(`${AUDIO_DIR}/mk/voice.gift.mp3`, new Uint8Array(MAX_CLIP_BYTES + 1).fill(0xff));
      put(`${AUDIO_DIR}/mk/voice.trophy.mp3`, [0x52, 0x49, 0x46, 0x46]);
      put(`${AUDIO_DIR}/mk/num.8.wav`, [0x52, 0x49, 0x46, 0x46]);
      put(`${AUDIO_DIR}/en/num.1.mp3`, frame);
      put(`${AUDIO_DIR}/de/num.1.mp3`, frame);
      put(`${AUDIO_DIR}/mk/.DS_Store`, [0]);
      expect(scanClips(tmp)).toEqual({ en: ['num.1'], mk: ['num.07', 'num.7', 'voice.gift', 'voice.trophy', 'voice.welcome', 'word.plus'] });
      const problems = clipProblems(tmp).join('\n');
      expect(problems).toMatch(/audio\/de: not a locale folder/);
      expect(problems).toMatch(/mk\/num\.07\.mp3: no voice line uses this clip id/);
      expect(problems).toMatch(/mk\/num\.8\.wav: not an \.mp3 file/);
      expect(problems).toMatch(/mk\/voice\.welcome\.mp3: empty file/);
      expect(problems).toMatch(/mk\/voice\.gift\.mp3: 151 KB/);
      expect(problems).toMatch(/mk\/voice\.trophy\.mp3: not an MP3/);
      expect(problems).not.toMatch(/num\.7\.mp3|word\.plus|en\/num\.1|DS_Store/);
    });

    it('accepts an ID3v2 tag or a bare MPEG frame header', () => {
      expect(clipFileProblem(Uint8Array.from(id3))).toBeNull();
      expect(clipFileProblem(Uint8Array.from(frame))).toBeNull();
      expect(clipFileProblem(Uint8Array.from([0xff, 0x00]))).toMatch(/not an MP3/);
      expect(renderManifest({ en: [], mk: ['num.7'] })).toBe('{\n  "en": [],\n  "mk": [\n    "num.7"\n  ]\n}\n');
    });
  });
});
