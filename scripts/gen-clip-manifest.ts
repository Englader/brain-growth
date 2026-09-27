/**
 * Drop-in recordings: scans public/audio/<locale>/*.mp3, writes
 * src/audio/clips.manifest.json (the clips the app plays) and refreshes the
 * "recorded" column of design/audio-recording-script.md. `prebuild` and
 * `predev` run it, so a recording only has to be dropped into its folder;
 * commit the files together with the regenerated manifest and script
 * (tests/audio.test.ts fails when the committed manifest is stale).
 *   npm run gen:clips
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requiredClips } from '../src/audio/voiceScript';
import { CLIP_MANIFEST, clipProblems, renderManifest, scanClips } from './clips';
import { AUDIO_SCRIPT_DOC, renderAudioScriptDoc } from './docs';

const root = resolve(__dirname, '..');

function writeIfChanged(rel: string, text: string): void {
  const path = resolve(root, rel);
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return;
  writeFileSync(path, text);
  console.log(`gen:clips: wrote ${rel}`);
}

const clips = scanClips();
writeIfChanged(CLIP_MANIFEST, renderManifest(clips));
writeIfChanged(AUDIO_SCRIPT_DOC, renderAudioScriptDoc(clips));
console.log(`gen:clips: ${Object.entries(clips).map(([loc, ids]) => `${loc} ${ids.length}/${requiredClips(loc).length}`).join(', ')} clips recorded`);
for (const p of clipProblems()) console.warn(`gen:clips: WARNING ${p}`);
