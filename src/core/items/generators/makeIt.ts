/**
 * Target ("Make it") deals as items: cards, a target and rules in a custom
 * 'target.deal' prompt; the child builds an expression and the 'target.expr'
 * checker re-parses it against the dealt cards (DESIGN §1.4, plan step 4).
 *
 * Two generators, one per board:
 *  - makeTen (Band A board, no reading): make 10 from 3–6 dot cards, adding;
 *  - makeIt  (Bands B/C board, which needs reading): 4 cards, + − × ÷, with
 *    per-skill options (operators, target range, card cap, a focus operator
 *    every solution must use, or negatives for integer skills).
 * The engine keeps them apart through the existing reading rule: Band A
 * sessions never allow 'reading' generators, so a pre-reader only ever gets
 * makeTen deals, while Bands B/C may get either.
 *
 * The item's `answer.value` is the target (logged as `expected`). Every
 * distinct way travels in the prompt data (`ways`, simplest first): the B/C
 * board draws it and "other ways" lists it; Band A's `solution` holds the
 * frog's hops for "show me".
 */
import { tk } from '../../../i18n/i18n';
import { rat, toNumber } from '../../rational';
import { checkDealRepr, readDealData, type TargetDealData } from '../../target/check';
import { makeDeal, toDealData, type DealOptions, type TargetDeal } from '../../target/deal';
import { leaves, parseRepr, toRepr } from '../../target/expr';
import { registerChecker } from '../checkers';
import { registerCustomPrompt } from '../customPrompts';
import type { CustomPrompt, GeneratedItem, GeneratorDef, LineSpec, SolutionStep } from '../types';

export const TARGET_PROMPT = 'target.deal';
export const TARGET_CHECKER = 'target.expr';

/** Binding config of makeIt: the band's board and the deal options for the skill. */
export interface MakeItConfig extends DealOptions {
  band?: 'B' | 'C';
}

/** Round a ruler step up to 1, 2, 5, 10, 20, 25, 50, 100… so it has at most ~10 labels. */
function niceStep(span: number): number {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500]) if (span / s <= 10) return s;
  return 1000;
}

/**
 * Band A: lily pads from 0 past the sum of the cards (tapping every card must
 * stay on the pads). B/C: a ruler from 0 to twice the target (min(0, 2t) to
 * max(0, 2t) for a negative target), so a miss shows how far off it is.
 */
export function targetLine(band: TargetDeal['band'], cards: readonly number[], target: number): LineSpec {
  if (band === 'A') {
    const max = Math.max(target + 2, cards.reduce((s, c) => s + Math.max(0, c), 0));
    return { min: 0, max, start: 0, major: 5, minor: 1, labelEvery: 1, steps: [1], flag: target, answerMode: 'land' };
  }
  const step = niceStep(Math.abs(2 * target));
  const lo = Math.floor(Math.min(0, 2 * target) / step) * step;
  const hi = Math.ceil(Math.max(0, 2 * target) / step) * step;
  const minor = step >= 5 && step % 5 === 0 ? step / 5 : step;
  return { min: lo, max: hi, start: 0, major: step, minor, labelEvery: step, steps: [1], flag: target, answerMode: 'land' };
}

/**
 * Band A: the frog's hops, card by card (dealt cards are all positive), which
 * "show me" replays. Bands B/C carry no worked-step lines: the board draws
 * the simplest way (and every other way) from the deal data, with locale
 * glyphs and stacked fractions, and builds its own hint tiers from it.
 */
function solutionFor(deal: TargetDeal): SolutionStep[] {
  const best = deal.solutions[0];
  if (!best || deal.band !== 'A') return [];
  const out: SolutionStep[] = [];
  let at = 0;
  for (const v of leaves(best.expr)) {
    out.push({ k: 'hop', from: at, to: at + v.n });
    at += v.n;
  }
  return out;
}

export function dealItem(deal: TargetDeal): GeneratedItem {
  return {
    level: deal.achievedLevel,
    prompt: { kind: 'custom', type: TARGET_PROMPT, data: { ...toDealData(deal), band: deal.band } },
    answer: { value: rat(deal.target), check: { id: TARGET_CHECKER } },
    line: targetLine(deal.band, deal.cards, deal.target),
    solution: solutionFor(deal),
    misconceptions: [],
    features: deal.features,
  };
}

export const makeTenGen: GeneratorDef<Record<string, never>> = {
  id: 'makeTen',
  version: 1,
  capabilities: ['deal', 'numeric'],
  generate(level, rng) {
    return dealItem(makeDeal(rng, 'A', level));
  },
};

export const makeItGen: GeneratorDef<MakeItConfig> = {
  id: 'makeIt',
  version: 1,
  capabilities: ['deal', 'numeric', 'reading'],
  generate(level, rng, cfg) {
    const { band = 'B', ...opts } = cfg;
    return dealItem(makeDeal(rng, band, level, opts));
  },
};

/** The deal data of a Target item, or null when the item is not one (or its data is malformed). */
export function targetData(item: Pick<GeneratedItem, 'prompt'>): (TargetDealData & { band: TargetDeal['band'] }) | null {
  const p = item.prompt;
  if (p.kind !== 'custom' || p.type !== TARGET_PROMPT) return null;
  const d = readDealData(p.data);
  const band = p.data.band;
  return d && (band === 'A' || band === 'B' || band === 'C') ? { ...d, band } : null;
}

// ── Grading: re-derive everything from the repr and the dealt cards ─────────
registerChecker(TARGET_CHECKER, (item, response) => {
  if (response.kind !== 'built') return { correct: false, given: '', invalid: true };
  // "Show me": the child asked for the answer. It ends the item as not solved (y = 0).
  if (response.data?.reveal) return { correct: false, given: 'reveal', misconception: null, delta: null };
  const r = checkDealRepr(item.prompt.kind === 'custom' ? item.prompt.data : null, response.repr);
  if (r.reason === 'parse') return { correct: false, given: response.repr.slice(0, 64), invalid: true };
  return {
    correct: r.ok,
    given: r.expr ? toRepr(r.expr) : response.repr,
    misconception: r.ok || r.reason === 'wrongValue' || !r.reason ? null : `target.${r.reason}`,
    delta: r.value ? toNumber(r.value) - toNumber(item.answer.value) : null,
  };
});

// ── Prompt: short instruction (B/C), voice line (Band A), and validation ────
registerCustomPrompt(TARGET_PROMPT, {
  text(p: CustomPrompt, _item, locale, band) {
    const d = readDealData(p.data);
    if (!d) return tk(locale, 'prompt.custom', {}, band);
    return tk(locale, d.mustUseAll ? 'target.promptAll' : 'target.prompt', { target: d.target }, band);
  },
  spoken(p) {
    const d = readDealData(p.data);
    if (!d) return null;
    return p.data.band === 'A' ? { key: 'voice.target.makeTen' } : { key: 'voice.target.make', params: { n: d.target } };
  },
  validate(p, item) {
    const d = targetData({ prompt: p });
    if (!d) return ['deal data is malformed'];
    const problems: string[] = [];
    if (toNumber(item.answer.value) !== d.target) problems.push('answer is not the target');
    if (item.answer.check?.id !== TARGET_CHECKER) problems.push('answer is not graded by target.expr');
    if (!d.ways.length) problems.push('deal has no solution');
    if (d.total < d.ways.length) problems.push('total is below the listed ways');
    for (const w of d.ways) {
      const c = checkDealRepr(p.data, w);
      if (!c.ok) problems.push(`way ${w} fails the checker (${c.reason})`);
    }
    const canons = new Set(d.ways.map((w) => checkDealRepr(p.data, w).canon));
    if (canons.size !== d.ways.length) problems.push('ways are not distinct');
    if (d.band === 'A') {
      if (d.target !== 10 || d.ops.join() !== '+' || d.cards.some((c) => c < 1 || c > 9)) problems.push('Band A deal is not make 10 with dot cards');
      const best = parseRepr(d.ways[0] ?? '');
      const hops = item.solution.filter((s) => s.k === 'hop').length;
      if (!best || hops !== leaves(best).length) problems.push('worked hops do not follow the simplest way');
    } else if (item.solution.length) problems.push('Bands B/C carry the worked solution in the deal, not in steps');
    return problems;
  },
});
