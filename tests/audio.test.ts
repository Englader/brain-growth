import { describe, expect, it } from 'vitest';
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

  it('recording budget stays small (under 60 clips per locale for the slice)', () => {
    for (const loc of allLocales()) expect(requiredClips(loc.id).length).toBeLessThan(60);
  });
});
