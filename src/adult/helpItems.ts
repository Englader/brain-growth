/**
 * The Help tab's list rows as text in the grown-up's language: the question
 * the child saw, rebuilt from its log record, and the child's answer and the
 * right one. Pure functions of (record, locale), so both languages are
 * testable.
 *
 * Rebuilding: a record carries the generator id and version, the seed and
 * (since the Help tab) the level asked of the generator (`req`); with the
 * skill's binding that regenerates the exact item. It is then checked
 * against the record (same answer, same achieved level). Older records lack
 * `req`: the achieved level alone does not pin the item down (the generator
 * picks among near candidates), so they show the skill and the logged
 * answers rather than a question the child may not have seen.
 */
import { BALANCE_PROMPT_TYPE, parseTranscript, readBalanceData } from '../core/balance';
import { COORD_PROMPT_TYPE, formatPoint, parsePointRepr, readCoordData } from '../core/coord';
import { getCustomPrompt } from '../core/items/customPrompts';
import { generatorLoaded, getGenerator, hasGenerator } from '../core/items/generators';
import type { Item } from '../core/items/types';
import { wasRevealed } from '../core/log/help';
import type { ItemRecord } from '../core/log/types';
import { key, parseKey, type Rational } from '../core/rational';
import { createRng } from '../core/rng';
import { GRAPH } from '../core/skills';
import { parseRepr, readDealData } from '../core/target';
import type { BandId, LocaleId } from '../core/types';
import { exampleRect, parseFracBarRepr, parseRectRepr, readFracBarData, readRectData } from '../core/workshop';
import { t, tk } from '../i18n/i18n';
import { getLocale } from '../i18n/locales';
import { formatFraction, formatNumber, formatRational } from '../i18n/numbers';
import { answerText, exprText, promptText, wordProblemText } from '../i18n/render';
import { equationText } from '../modes/balance/format';
import { exprText as targetExprText } from '../modes/target/format';

/** The Target deal prompt type (TARGET_PROMPT in core/items/generators/makeIt.ts, a module loaded with the mode). */
export const TARGET_PROMPT_TYPE = 'target.deal';

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** The exact item a record was about, or null when it cannot be rebuilt faithfully. */
export function rebuildItem(r: ItemRecord): Item | null {
  if (typeof r.req !== 'number' || !Number.isFinite(r.req) || r.source === 'fixed') return null;
  if (!GRAPH.has(r.skill) || !hasGenerator(r.gen) || !generatorLoaded(r.gen)) return null;
  const gen = getGenerator(r.gen);
  if (gen.version !== r.genV) return null;
  const binding = GRAPH.get(r.skill).gens?.find((b) => b.id === r.gen);
  if (!binding) return null;
  try {
    const g = gen.generate(r.req, createRng(r.seed), binding.config ?? {});
    if (key(g.answer.value) !== r.expected || round3(g.level) !== r.level) return null;
    return { ...g, key: r.key, skillId: r.skill, genId: r.gen, genVersion: r.genV, seed: r.seed, req: r.req };
  } catch {
    return null;
  }
}

const num = (n: number, locale: LocaleId): string => formatNumber(n, getLocale(locale).numbers);
const ratText = (v: Rational, locale: LocaleId): string => formatRational(v, getLocale(locale).numbers);
const eq = (lhs: string, rhs: string, locale: LocaleId): string => `${lhs} ${getLocale(locale).ops['=']} ${rhs}`;
const xIs = (v: string, locale: LocaleId): string => eq(tk(locale, 'balance.var'), v, locale);

/** The question as one line of text, in `locale`. */
export function questionText(item: Item, locale: LocaleId, band: BandId): string {
  const p = item.prompt;
  switch (p.kind) {
    case 'expr':
      return eq(exprText(p.expr, locale), p.rhs ? exprText(p.rhs, locale) : '?', locale);
    case 'locate': {
      const n = p.display ? exprText(p.display, locale) : num(p.target, locale);
      return t(locale, item.answer.tolerance ? 'help.q.estimate' : 'help.q.locate', { n });
    }
    case 'compare':
      return t(locale, p.pick === 'max' ? 'help.q.bigger' : 'help.q.smaller', { a: exprText(p.a, locale), b: exprText(p.b, locale) });
    case 'read':
      return t(locale, 'help.q.read');
    case 'percentOf':
      return t(locale, 'help.q.percent', { pct: p.pct, of: p.of });
    case 'count':
      return t(locale, 'help.q.count');
    case 'blocks':
      return t(locale, 'help.q.blocks');
    case 'groups':
      return t(locale, 'help.q.groups', { groups: p.groups, size: p.size });
    case 'word':
      return wordProblemText(p, locale);
    case 'custom': {
      if (p.type === TARGET_PROMPT_TYPE) {
        const d = readDealData(p.data);
        if (d) return t(locale, d.mustUseAll ? 'help.q.targetAll' : 'help.q.target', { target: d.target, cards: d.cards.map((c) => num(c, locale)).join(', ') });
      }
      if (p.type === BALANCE_PROMPT_TYPE) {
        const d = readBalanceData(p.data);
        if (d) return t(locale, 'help.q.solve', { eq: equationText(d.eq, locale) });
      }
      if (p.type === COORD_PROMPT_TYPE) {
        const d = readCoordData(p.data);
        if (d) return d.read ? t(locale, 'help.q.readPoint') : t(locale, 'help.q.plot', { point: formatPoint(d, getLocale(locale)) });
      }
      // Workshop tasks, Hop's missing number and walk: the prompt's own sentence says it all.
      return getCustomPrompt(p.type)?.text(p, item, locale, band) ?? promptText(item, locale, band);
    }
  }
}

export interface AnswerTexts {
  /** What the child gave; null when the child asked to be shown the answer. */
  given: string | null;
  /** The right answer (for a construction with many right answers: one of them); null when the record alone cannot say it. */
  correct: string | null;
}

/** The child's answer and the right one, in `locale`, from the record (and the rebuilt item when there is one). */
export function answerTexts(r: ItemRecord, item: Item | null, locale: LocaleId): AnswerTexts {
  const shown = wasRevealed(r);
  const conv = getLocale(locale).numbers;
  // A logged rational key as the child would read it: fractions stay fractions on a fraction skill.
  const style = GRAPH.has(r.skill) && GRAPH.get(r.skill).strand === 'fractions' ? 'fraction' : 'auto';
  const plain = (s: string): string => {
    const v = parseKey(s);
    return Number.isFinite(v.n) && Number.isFinite(v.d) && v.d !== 0 ? formatRational(v, conv, style) : s;
  };
  const data = item && item.prompt.kind === 'custom' ? item.prompt.data : null;
  // What the child gave, read the way the mode logged it (null: not readable, then the logged text).
  let given: string | null = null;
  let correct: string | null = item ? answerText(item, locale) : plain(r.expected);
  switch (r.gen) {
    case 'equation': {
      const v = parseTranscript(r.answer)?.value;
      if (v) given = xIs(ratText(v, locale), locale);
      correct = xIs(plain(r.expected), locale);
      break;
    }
    case 'makeIt':
    case 'makeTen': {
      const target = plain(r.expected);
      const e = parseRepr(r.answer);
      if (e) given = eq(targetExprText(e, locale), target, locale);
      const d = data ? readDealData(data) : null;
      const way = d?.ways[0] ? parseRepr(d.ways[0]) : null;
      correct = way ? eq(targetExprText(way, locale), target, locale) : null;
      break;
    }
    case 'fracBar': {
      const g = parseFracBarRepr(r.answer);
      if (g) given = t(locale, 'help.a.bar', { shaded: typeof g.shaded === 'number' ? g.shaded : g.shaded.length, parts: g.parts });
      const d = data ? readFracBarData(data) : null;
      correct = d ? formatFraction(d.n, d.d, conv) : formatRational(parseKey(r.expected), conv, 'fraction');
      break;
    }
    case 'rectBuild': {
      const g = parseRectRepr(r.answer);
      if (g) given = t(locale, 'help.a.rect', { w: g.w, h: g.h });
      const c = data ? readRectData(data) : null;
      const ex = c ? exampleRect(c) : null;
      // Without the task the log holds only the asked measure: no rectangle to show.
      correct = ex ? t(locale, 'help.a.rectExample', { w: ex.w, h: ex.h }) : null;
      break;
    }
    case 'coord': {
      const g = parsePointRepr(r.answer);
      if (g) given = formatPoint(g, getLocale(locale));
      const d = data ? readCoordData(data) : null;
      // The point is in the task only (the logged value is 0).
      correct = d ? formatPoint(d, getLocale(locale)) : null;
      break;
    }
    default:
      given = plain(r.answer);
  }
  return { given: shown ? null : given ?? r.answer, correct };
}

/** A list row's texts: the question (null when the item cannot be rebuilt) and the answers. */
export function describeRecord(r: ItemRecord, locale: LocaleId): { question: string | null } & AnswerTexts {
  const item = rebuildItem(r);
  let question: string | null = null;
  if (item) {
    try {
      question = questionText(item, locale, r.band);
    } catch {
      question = null;
    }
  }
  return { question, ...answerTexts(r, item, locale) };
}
