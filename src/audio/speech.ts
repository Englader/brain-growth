/**
 * Speaking to pre-readers. Resolution order for every line:
 *   1. recorded clips (all clips of the line exist for the locale)
 *   2. a speech-synthesis voice whose language IS the locale's language
 *   3. silence — the Band A UI is designed to work from pictures alone
 * A Serbian or Bulgarian voice reading Macedonian is never used: wrong
 * pronunciation taught to a five-year-old is worse than no voice.
 */
import type { LocaleId } from '../core/types';
import type { MessageParams } from '../i18n/format';
import { tk } from '../i18n/i18n';
import { getLocale } from '../i18n/locales';
import { clipUrl, hasClip } from './clips';
import { numberClips, voiceLine } from './voiceScript';

export interface VoiceInfo {
  locale: LocaleId;
  voices: Array<{ name: string; lang: string; local: boolean }>;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

export class Speaker {
  private queue: HTMLAudioElement[] = [];
  private token = 0;

  constructor(private readonly allowTts: () => boolean) {
    // Voices load asynchronously in Chrome; touching the list starts the load.
    synth()?.getVoices();
  }

  voicesFor(locale: LocaleId): SpeechSynthesisVoice[] {
    const s = synth();
    if (!s) return [];
    const wanted = getLocale(locale).speech.map((l) => l.toLowerCase());
    const all = s.getVoices();
    const match = (v: SpeechSynthesisVoice): number => {
      const lang = v.lang.toLowerCase().replace('_', '-');
      const i = wanted.findIndex((w) => lang === w || lang.startsWith(`${w}-`) || (w.length === 2 && lang.split('-')[0] === w));
      return i < 0 ? Infinity : i;
    };
    return all
      .filter((v) => match(v) < Infinity)
      .sort((a, b) => match(a) - match(b) || Number(b.localService) - Number(a.localService));
  }

  report(): VoiceInfo[] {
    return (['en', 'mk'] as LocaleId[]).map((locale) => ({
      locale,
      voices: this.voicesFor(locale).map((v) => ({ name: v.name, lang: v.lang, local: v.localService })),
    }));
  }

  stop(): void {
    this.token++;
    for (const a of this.queue) a.pause();
    this.queue = [];
    synth()?.cancel();
  }

  /** Speak a voice.* line. Returns false if nothing could be spoken. */
  say(key: string, params: MessageParams, locale: LocaleId): boolean {
    this.stop();
    const clips = this.clipsFor(key, params, locale);
    if (clips) {
      this.playClips(clips, locale);
      return true;
    }
    return this.sayText(tk(locale, key, params), locale);
  }

  sayText(text: string, locale: LocaleId): boolean {
    const s = synth();
    if (!s || !this.allowTts()) return false;
    const voice = this.voicesFor(locale)[0];
    if (!voice) return false;
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.9;
    u.pitch = 1.05;
    s.speak(u);
    return true;
  }

  private clipsFor(key: string, params: MessageParams, locale: LocaleId): string[] | null {
    const line = voiceLine(key, locale);
    if (!line) return null;
    const out: string[] = [];
    for (const tok of line) {
      if (tok.startsWith('{')) {
        const n = Number(params[tok.slice(1, -1)]);
        const nc = numberClips(n, locale);
        if (!nc) return null;
        out.push(...nc);
      } else out.push(tok);
    }
    return out.every((c) => hasClip(locale, c)) ? out : null;
  }

  private playClips(ids: string[], locale: LocaleId): void {
    const my = ++this.token;
    this.queue = ids.map((id) => new Audio(clipUrl(locale, id)));
    const playAt = (i: number): void => {
      if (my !== this.token || i >= this.queue.length) return;
      const a = this.queue[i]!;
      a.onended = () => playAt(i + 1);
      void a.play().catch(() => undefined);
    };
    playAt(0);
  }
}
