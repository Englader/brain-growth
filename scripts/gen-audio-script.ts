/**
 * Generates design/audio-recording-script.md: every clip a voice actor must
 * record per locale, with its text, file name and the total budget
 * (tests/generated-docs.test.ts enforces that it is current).
 *   npm run gen:audio-script
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUDIO_SCRIPT_DOC, renderAudioScriptDoc } from './docs';

const out = resolve(__dirname, '..', AUDIO_SCRIPT_DOC);
writeFileSync(out, renderAudioScriptDoc());
console.log(`wrote ${out}`);
