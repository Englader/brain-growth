/**
 * The adaptive hint ladder (DESIGN §1.11; §4 step 5), derived per item from
 * its worked solution. It is locale-agnostic data: every rung is a message
 * key with params, rendered by i18n/render.solutionText, so switching the
 * language mid-item re-renders the same ladder.
 *
 *   tier 1  a strategy prompt, mapped from the item's primary `sol.*` key
 *           (makeTen → "Make a ten first, then add the rest"). Its text never
 *           contains a number. Unknown keys get a generic prompt.
 *   tier 2  the first hop of the worked solution, drawn as a trail on the line.
 *   tier 3  the first worked step: the first `say` that does not give the
 *           answer away.
 *
 * Any rung that would reveal the answer is skipped: the first hop may not
 * start or end on the answer (or on a count item's flag), and a worked step
 * may not carry the answer (or its negation, which templates print as
 * "−{b}") among its numbers. tests/hints.test.ts renders
 * every rung of 200 items per playable binding in every locale and checks
 * that no text shows the formatted answer.
 *
 * A correct answer after tier t earns 1 − 0.25·t (engine/observe.hintCredit).
 */
import type { ItemRecord, LogRecord } from '../log/types';
import { toNumber } from '../rational';
import type { Item, Op, SolutionStep } from './types';

export type SayStep = Extract<SolutionStep, { k: 'say' }>;
export type HintTier = 1 | 2 | 3;

export interface HintRung {
  tier: HintTier;
  /** What the rung says: a message key and its params (op params render as the locale's glyphs). */
  say: SayStep;
  /** Tier 2 only: the hop drawn on the number line. */
  hop?: { from: number; to: number };
}

/** Message key of every strategy prompt: `hint.s.<id>`. */
export const STRATEGY_PREFIX = 'hint.s.';
/** Message key of the tier-2 text (params `from`, `to`). */
export const HOP_KEY = 'hint.hop';

const OP_NAME: Record<Op, string> = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' };

/**
 * Strategy id for each solution key the generators emit. `split` and `step`
 * depend on the operation and resolve to `split.add`, `step.sub`, …
 */
export const STRATEGY_BY_SOL: Readonly<Record<string, string>> = {
  'sol.count': 'count',
  'sol.locateTens': 'locateTens',
  'sol.locateHundreds': 'locateHundreds',
  'sol.locateNeg': 'locateNeg',
  'sol.blocks2': 'blocks2',
  'sol.blocks3': 'blocks3',
  'sol.bond': 'bond',
  'sol.makeTen': 'makeTen',
  'sol.backThroughTen': 'backThroughTen',
  'sol.countOn': 'countOn',
  'sol.countBack': 'countBack',
  'sol.split2': 'split',
  'sol.split3': 'split',
  'sol.step': 'step',
  'sol.times9': 'times9',
  'sol.doubleDouble': 'doubleDouble',
  'sol.fivePlus': 'fivePlus',
  'sol.repeatedAdd': 'repeatedAdd',
  'sol.divAsHops': 'divAsHops',
  'sol.timesTen': 'timesTen',
  'sol.zeros': 'zeros',
  'sol.addPartials': 'addPartials',
  'sol.subNeg': 'subNeg',
  'sol.addNeg': 'addNeg',
  'sol.intMove': 'intMove',
};

/** Operations the op-dependent strategies have prompts for. */
const OP_STRATEGIES: Readonly<Record<string, readonly string[]>> = {
  split: ['add', 'sub', 'mul'],
  step: ['add', 'sub'],
};

export const GENERIC_STRATEGY = 'generic';

const isSay = (s: SolutionStep): s is SayStep => s.k === 'say';

/** The item's operation: from its worked steps (word problems too), else from its expression. */
function opOf(item: Item): Op | null {
  for (const s of item.solution) {
    if (s.k === 'say' && typeof s.params.op === 'string' && s.params.op in OP_NAME) return s.params.op as Op;
  }
  const p = item.prompt;
  return p.kind === 'expr' && p.expr.k === 'op' ? p.expr.op : null;
}

/** Strategy id of an item (tier 1): from its first worked-step key; `generic` for keys without a prompt. */
export function strategyId(item: Item): string {
  const first = item.solution.find(isSay);
  const base = first ? STRATEGY_BY_SOL[first.key] : undefined;
  if (!base) return GENERIC_STRATEGY;
  const ops = OP_STRATEGIES[base];
  if (!ops) return base;
  const op = opOf(item);
  return op && ops.includes(OP_NAME[op]) ? `${base}.${OP_NAME[op]}` : GENERIC_STRATEGY;
}

/** Every strategy id that has a prompt (tests check each has strings in every locale). */
export function allStrategyIds(): string[] {
  const ids = new Set<string>([GENERIC_STRATEGY]);
  for (const base of Object.values(STRATEGY_BY_SOL)) {
    const ops = OP_STRATEGIES[base];
    if (ops) ops.forEach((o) => ids.add(`${base}.${o}`));
    else ids.add(base);
  }
  return [...ids];
}

/**
 * The ladder for an item, lowest tier first, with every revealing rung
 * already skipped. Tier 1 is always present.
 */
export function hintLadder(item: Item): HintRung[] {
  const answer = toNumber(item.answer.value);
  const line = item.line;
  // A number reveals the answer if it is the answer or its negation: templates such as
  // "{a} + (−{b})" print a minus of their own, so b = −answer would show the answer.
  const reveals = (v: unknown): boolean => v === answer || v === -answer || (typeof v === 'string' && v === String(answer));
  const rungs: HintRung[] = [{ tier: 1, say: { k: 'say', key: `${STRATEGY_PREFIX}${strategyId(item)}`, params: {} } }];

  const hop = item.solution.find((s): s is Extract<SolutionStep, { k: 'hop' }> => s.k === 'hop');
  if (hop && hop.from !== hop.to) {
    // Count items are answered by where the hops stop (the flag); land items by the answer itself.
    const stop = line.answerMode === 'count' ? line.flag : answer;
    const gives = [hop.from, hop.to].some((v) => reveals(v) || v === stop);
    if (!gives) rungs.push({ tier: 2, say: { k: 'say', key: HOP_KEY, params: { from: hop.from, to: hop.to } }, hop: { from: hop.from, to: hop.to } });
  }

  const step = item.solution.find((s): s is SayStep => isSay(s) && !s.key.startsWith('sol.count') && !Object.values(s.params).some(reveals));
  if (step) rungs.push({ tier: 3, say: step });
  return rungs;
}

/** When the hint button starts to pulse (DESIGN §1.11). */
export const HINT_PULSE = {
  /** A pause longer than this many times the child's median latency on the skill. */
  FACTOR: 1.5,
  /** Never sooner than this (the pulse must not nag a fast child), never later than this. */
  MIN_MS: 8_000,
  MAX_MS: 60_000,
  /** Median assumed with too little history. */
  DEFAULT_MEDIAN_MS: 12_000,
  /** Latencies needed before a median is trusted: the skill's own, else all of the child's. */
  MIN_SAMPLES: 3,
  /** Most recent first attempts considered. */
  WINDOW: 30,
} as const;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Pause (ms without input) after which the hint button pulses: 1.5× the
 * child's median latency on this skill (untimed first attempts), falling back
 * to their median over all skills, then to a default; clamped to [8 s, 60 s].
 */
export function pulseDelayMs(log: readonly LogRecord[], skillId: string): number {
  const firsts = log.filter((r): r is ItemRecord => r.type === 'item' && r.attempt === 1 && !r.timed && r.latency > 0);
  const recent = (xs: ItemRecord[]): number[] => xs.slice(-HINT_PULSE.WINDOW).map((r) => r.latency);
  const own = recent(firsts.filter((r) => r.skill === skillId));
  const all = recent(firsts);
  const med = own.length >= HINT_PULSE.MIN_SAMPLES ? median(own) : all.length >= HINT_PULSE.MIN_SAMPLES ? median(all) : HINT_PULSE.DEFAULT_MEDIAN_MS;
  return Math.round(Math.min(HINT_PULSE.MAX_MS, Math.max(HINT_PULSE.MIN_MS, HINT_PULSE.FACTOR * med)));
}
