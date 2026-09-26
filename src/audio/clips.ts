/**
 * Recorded clip manifest: clip ids available as files under
 * public/audio/<locale>/<clip-id>.mp3 (MP3: plays on every target browser,
 * including older iOS Safari that lacks Opus). Empty until recordings exist;
 * add ids here as files are added. The SW precaches whatever is in public/.
 */
import type { LocaleId } from '../core/types';

export const RECORDED_CLIPS: Record<LocaleId, readonly string[]> = {
  en: [],
  mk: [],
};

export function hasClip(locale: LocaleId, id: string): boolean {
  return RECORDED_CLIPS[locale]?.includes(id) ?? false;
}

export function clipUrl(locale: LocaleId, id: string): string {
  return `audio/${locale}/${id}.mp3`;
}
