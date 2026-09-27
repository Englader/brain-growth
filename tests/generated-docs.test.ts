/**
 * Generated docs must match their sources. If this fails, run the command in
 * the message and commit the result.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIO_SCRIPT_DOC, renderAudioScriptDoc, renderSkillGraphDoc, SKILL_GRAPH_DOC } from '../scripts/docs';

const read = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('generated docs are current', () => {
  it(`${SKILL_GRAPH_DOC} (npm run gen:skill-doc)`, () => {
    expect(read(SKILL_GRAPH_DOC) === renderSkillGraphDoc(), 'stale: run npm run gen:skill-doc').toBe(true);
  });
  it(`${AUDIO_SCRIPT_DOC} (npm run gen:audio-script)`, () => {
    expect(read(AUDIO_SCRIPT_DOC) === renderAudioScriptDoc(), 'stale: run npm run gen:audio-script').toBe(true);
  });
});
