/**
 * Custom-prompt registry. A mode-specific prompt (`{ kind: 'custom', type,
 * data }`) is rendered and validated through the definition registered under
 * its `type`, so adding one never edits the renderers' switch statements:
 * render.ts (promptText, spokenPrompt), PlayView and tests/skills.test.ts all
 * consult this registry.
 *
 * Register from the generator module that emits the prompt (the definition's
 * text functions may import the i18n layer):
 *
 *   registerCustomPrompt('target.deal', {
 *     text: (p, item, locale, band) => tk(locale, 'target.prompt', { n: Number(p.data.target) }, band),
 *     spoken: (p) => ({ key: 'voice.target.makeTen' }),
 *     validate: (p, item) => (… ? [] : ['target is not reachable']),
 *   });
 */
import type { BandId, LocaleId } from '../types';
import type { CustomPrompt, GeneratedItem } from './types';

export interface CustomPromptDef {
  /** Short on-screen instruction (Bands B/C). */
  text(prompt: CustomPrompt, item: GeneratedItem, locale: LocaleId, band: BandId): string;
  /**
   * What Band A hears: a voice line key (voice.<feature>.*, so it can be
   * recorded as clips) and its numeric params. Omit or return null for silence.
   */
  spoken?(prompt: CustomPrompt, item: GeneratedItem): { key: string; params?: Record<string, number> } | null;
  /** Test hook (tests/skills.test.ts): problems with the item, e.g. "the answer does not follow from the data". */
  validate?(prompt: CustomPrompt, item: GeneratedItem): string[];
}

const registry = new Map<string, CustomPromptDef>();

export function registerCustomPrompt(type: string, def: CustomPromptDef): void {
  if (registry.has(type)) throw new Error(`custom prompt ${type} registered twice`);
  registry.set(type, def);
}

export function getCustomPrompt(type: string): CustomPromptDef | undefined {
  return registry.get(type);
}
