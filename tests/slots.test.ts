/**
 * Parallel-work seams (CONTRIBUTING: "Parallel work conventions"). Features
 * insert code directly under their own `// ── slot: <feature> ──` anchor and
 * strings inside their own reserved locale block, so parallel branches touch
 * disjoint lines and merge cleanly. This guards the scaffolding itself:
 * anchors present, complete and in the fixed order; locale bundles with the
 * same keys in the same order.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

export const SLOT_ORDER = ['frac', 'hint', 'pilot', 'storage', 'weekly', 'target', 'dice', 'puzzle', 'workshop', 'balance', 'coord', 'season'];

/** File → number of anchor regions it holds (each region lists every feature once, in order). */
const SLOTTED: Record<string, number> = {
  'src/modes/index.ts': 1,
  'src/ui/widgets/index.ts': 1,
  'src/core/items/generators/index.ts': 3,
  'src/core/items/types.ts': 1,
  'src/core/achievements/definitions.ts': 1,
  'src/core/achievements/index.ts': 1,
  'src/core/flags.ts': 1,
  'src/core/log/types.ts': 1,
  'src/audio/voiceScript.ts': 1,
  'src/ui/components/Icon.tsx': 1,
  'src/core/profile.ts': 2,
  'src/data/merge.ts': 1,
  'src/core/rewards/cosmetics.ts': 1,
  'src/core/engine/params.ts': 1,
};

/** Reserved locale blocks: top level (after "clip") and inside shared namespaces. */
export const LOCALE_SLOTS: Record<string, string[]> = {
  '': SLOT_ORDER,
  voice: ['frac', 'weekly', 'target', 'dice', 'puzzle', 'workshop', 'season'],
  sol: ['frac', 'target', 'dice', 'workshop', 'balance', 'coord'],
  mis: ['frac', 'target', 'workshop', 'balance', 'coord'],
  cos: ['weekly', 'season'],
  ach: ['frac', 'weekly', 'target', 'dice', 'puzzle', 'workshop', 'balance', 'coord', 'season'],
};

const read = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf8');
type Json = { [k: string]: string | Json };

describe('slot anchors in shared TypeScript', () => {
  for (const [file, regions] of Object.entries(SLOTTED)) {
    it(file, () => {
      const anchors = [...read(file).matchAll(/\/\/ ── slot: ([a-z]+) ──/g)].map((m) => m[1]);
      expect(anchors).toEqual(Array.from({ length: regions }, () => SLOT_ORDER).flat());
    });
  }
});

describe('locale bundles', () => {
  const en = JSON.parse(read('src/i18n/locales/en.json')) as Json;
  const mk = JSON.parse(read('src/i18n/locales/mk.json')) as Json;
  const paths = (o: Json, pre = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [`${pre}${k}`] : [`${pre}${k}/`, ...paths(v, `${pre}${k}.`)]));

  it('en and mk have the same keys in the same order (so feature blocks merge line by line)', () => {
    expect(paths(mk)).toEqual(paths(en));
  });

  for (const [ns, feats] of Object.entries(LOCALE_SLOTS)) {
    it(`reserved blocks ${ns || '(top level)'}: ${feats.join(', ')}`, () => {
      for (const loc of [en, mk]) {
        const scope = (ns ? loc[ns] : loc) as Json;
        const keys = Object.keys(scope);
        for (const f of feats) expect(typeof scope[f], `${ns}.${f}`).toBe('object');
        // Reserved blocks keep the fixed order and sit at the end of their namespace.
        expect(keys.slice(-feats.length), ns).toEqual(feats);
      }
    });
  }
});
