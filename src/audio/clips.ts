/**
 * Recorded clips: files under public/audio/<locale>/<clip-id>.mp3 (MP3 plays
 * on every target browser, including older iOS Safari that lacks Opus).
 * `npm run gen:clips` lists them in clips.manifest.json; prebuild and predev
 * run it, so dropping a file into its folder is all it takes. The SW
 * precaches whatever is in public/.
 */
import type { LocaleId } from '../core/types';
import { tk } from '../i18n/i18n';
import manifest from './clips.manifest.json';
import { requiredClips } from './voiceScript';

export const RECORDED_CLIPS: Readonly<Record<LocaleId, readonly string[]>> = manifest;

const sets = new Map<LocaleId, Set<string>>();

export function hasClip(locale: LocaleId, id: string): boolean {
  let s = sets.get(locale);
  if (!s) {
    s = new Set(RECORDED_CLIPS[locale] ?? []);
    sets.set(locale, s);
  }
  return s.has(id);
}

export function clipUrl(locale: LocaleId, id: string): string {
  return `audio/${locale}/${id}.mp3`;
}

/** The file name a clip is recorded to. */
export function clipFile(id: string): string {
  return `${id}.mp3`;
}

/** What the voice actor says for a clip, in the clip's own language. */
export function clipText(locale: LocaleId, id: string): string {
  return id.startsWith('voice.') ? tk(locale, id, {}) : tk(locale, `clip.${id}`);
}

/** Clips a locale's voice lines need that are not recorded yet: the recording checklist. */
export function missingClips(locale: LocaleId): string[] {
  return requiredClips(locale).filter((id) => !hasClip(locale, id));
}
