/**
 * Word problems: an arithmetic generator picks numbers at the requested level,
 * then the item is wrapped in a template id. Template TEXT lives per locale
 * (src/i18n/wordproblems/*.json) and is authored, not translated; every locale
 * must provide every template id with the same variable slots, so difficulty
 * stays matched and a mid-item language switch re-renders the same problem.
 */
import type { GeneratorDef } from '../types';
import { getGenerator } from './registry';

export interface WordConfig {
  template: string;
  base: { id: string; config?: Record<string, unknown> };
}

export const wordGen: GeneratorDef<WordConfig> = {
  id: 'word',
  version: 1,
  capabilities: ['numberLine', 'numeric', 'reading'],
  generate(level, rng, cfg) {
    const base = getGenerator(cfg.base.id);
    // Reading adds load: ask the base generator for a slightly easier calculation.
    const item = base.generate(Math.max(0, level - 0.1), rng, cfg.base.config ?? {});
    if (item.prompt.kind !== 'expr' || item.prompt.expr.k !== 'op') {
      throw new Error(`word template ${cfg.template} needs a binary expression base item`);
    }
    const { a, b } = item.prompt.expr;
    if (a.k !== 'num' || b.k !== 'num') throw new Error('word base must be numeric');
    return {
      ...item,
      level: Math.min(1, item.level + 0.1),
      prompt: { kind: 'word', templateId: cfg.template, vars: { a: a.v, b: b.v }, nameSeed: rng.int(0, 1_000_000) },
      features: { ...item.features, word: 1 },
    };
  },
};
