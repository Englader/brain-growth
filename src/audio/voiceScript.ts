/**
 * Spoken lines as sequences of recordable clips.
 *
 * Browser speech synthesis for mk-MK is effectively absent on the devices
 * children use (no Macedonian voice ships with iOS, Android's Google TTS or
 * desktop Chrome; Microsoft Edge's online "natural" voices include Macedonian
 * but need a network and that one browser). Band A cannot depend on it, so
 * every spoken line is defined as clips a person can record once:
 * whole phrases, a few words, and number words composed per locale.
 *
 * `npm run gen:audio-script` turns this file + the locale bundles into the
 * recording script and budget (design/audio-recording-script.md).
 */
import type { LocaleId } from '../core/types';

/** `{param}` tokens are numbers spoken via numberClips; other tokens are clip ids. */
export type VoiceLine = readonly string[];

const DEFAULT_LINES: Record<string, VoiceLine> = {
  'voice.welcome': ['voice.welcome'],
  'voice.count': ['voice.count'],
  'voice.blocks': ['voice.blocks'],
  'voice.locate': ['cmd.hopTo', '{n}'],
  'voice.add': ['{a}', 'word.plus', '{b}', 'cmd.whereLand'],
  'voice.sub': ['{a}', 'word.minus', '{b}', 'cmd.whereLand'],
  'voice.mul': ['{a}', 'word.times', '{b}', 'cmd.whereLand'],
  'voice.div': ['{a}', 'word.dividedBy', '{b}', 'cmd.howManyHops'],
  'voice.bond': ['{a}', 'cmd.andHowMany', '{total}'],
  'voice.groups': ['{n}', 'word.hopsOf', '{size}'],
  'voice.praise1': ['voice.praise1'],
  'voice.praise2': ['voice.praise2'],
  'voice.praise3': ['voice.praise3'],
  'voice.praise4': ['voice.praise4'],
  'voice.lookTogether': ['voice.lookTogether'],
  'voice.tapGlow': ['voice.tapGlow'],
  'voice.gift': ['voice.gift'],
  'voice.sessionDone': ['voice.sessionDone'],
  'voice.trophy': ['voice.trophy'],
  // Feature voice lines (keys `voice.<feature>.*`), each under its own anchor:
  // ── slot: frac ──
  // ── slot: hint ──
  // ── slot: pilot ──
  // ── slot: storage ──
  // ── slot: weekly ──
  // ── slot: target ──
  // ── slot: dice ──
  // ── slot: puzzle ──
  'voice.puzzle.shelf': ['voice.puzzle.shelf'],
  'voice.puzzle.pattern': ['voice.puzzle.pattern'],
  'voice.puzzle.balance': ['voice.puzzle.balance'],
  'voice.puzzle.notYet': ['voice.puzzle.notYet'],
  'voice.puzzle.solved': ['voice.puzzle.solved'],
  'voice.puzzle.together': ['voice.puzzle.together'],
  'voice.puzzle.hint.unit': ['voice.puzzle.hint.unit'],
  'voice.puzzle.hint.same': ['voice.puzzle.hint.same'],
  'voice.puzzle.hint.groups': ['voice.puzzle.hint.groups'],
  'voice.puzzle.hint.grows': ['voice.puzzle.hint.grows'],
  'voice.puzzle.hint.start': ['voice.puzzle.hint.start'],
  'voice.puzzle.hint.remove': ['voice.puzzle.hint.remove'],
  'voice.puzzle.hint.share': ['voice.puzzle.hint.share'],
  'voice.puzzle.hint.count': ['voice.puzzle.hint.count'],
  'voice.puzzle.hint.known': ['voice.puzzle.weighs', '{weight}'],
  // ── slot: workshop ──
  // ── slot: balance ──
  // ── slot: coord ──
  // ── slot: season ──
};

/** Per-locale overrides where word order differs (none needed for en/mk yet). */
const LOCALE_LINES: Record<LocaleId, Partial<Record<string, VoiceLine>>> = {};

export function voiceLine(key: string, locale: LocaleId): VoiceLine | undefined {
  return LOCALE_LINES[locale]?.[key] ?? DEFAULT_LINES[key];
}

export function allVoiceKeys(): string[] {
  return Object.keys(DEFAULT_LINES);
}

/**
 * Number words as clips. Both locales compose 21–99 from a tens word and a
 * units word; Macedonian joins them with "и" ("дваесет и три").
 */
export function numberClips(n: number, locale: LocaleId): string[] | null {
  if (!Number.isInteger(n) || n < 0 || n > 100) return null;
  if (n <= 20 || n % 10 === 0) return [`num.${n}`];
  const tens = Math.floor(n / 10) * 10;
  const ones = n % 10;
  return locale === 'mk' ? [`num.${tens}`, 'word.and', `num.${ones}`] : [`num.${tens}`, `num.${ones}`];
}

/** Every clip id a locale needs for the lines above with numbers 0–100. */
export function requiredClips(locale: LocaleId): string[] {
  const out = new Set<string>();
  for (const key of allVoiceKeys()) {
    for (const tok of voiceLine(key, locale) ?? []) if (!tok.startsWith('{')) out.add(tok);
  }
  for (let n = 0; n <= 100; n++) for (const c of numberClips(n, locale) ?? []) out.add(c);
  return [...out].sort();
}
