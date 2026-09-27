/**
 * `eqBond` (numberLine, numeric): the Hop binding for `al.eq.onestep`, a
 * missing number on a signed line ("? + 5 = 2", "−3 + ? = 4", "? · 3 = −12").
 * `al.eq.onestep` is a prerequisite of `al.eq.linear`, so it must stay
 * servable by Hop, or a child without the Balance mode would meet a wall
 * (tests/walls.test.ts). Hop serves it, so it is eager (BUILTIN), in its own
 * small module; the Balance generator loads on demand (./equation.ts).
 *
 * The prompt is a custom one so its instruction says "find the missing
 * number" (the generic `expr`-with-`rhs` text is the counting-hops bond
 * prompt). This module registers it once.
 */
import { eqn, type Equation } from '../../balance/equation';
import { balanceMisconceptions } from '../../balance/check';
import { equationFeatures, scoreEquation } from '../../balance/generate';
import { BALANCE_SOL_KEYS, describeMove } from '../../balance/keys';
import { solutionPath } from '../../balance/moves';
import { t } from '../../../i18n/i18n';
import { getLocale } from '../../../i18n/locales';
import { exprTokens, tokensText } from '../../../i18n/render';
import { rat, toNumber } from '../../rational';
import type { Rng } from '../../rng';
import { getCustomPrompt, registerCustomPrompt } from '../customPrompts';
import type { Expr, GeneratorDef, SolutionStep } from '../types';
import { BLANK, bin, evalExpr, num, pickByLevel } from '../util';

/** The Hop missing-number prompt: `{ kind: 'custom', type: BOND_PROMPT_TYPE, data: { expr, rhs } }`. */
export const BOND_PROMPT_TYPE = 'balance.bond';

if (!getCustomPrompt(BOND_PROMPT_TYPE)) {
  registerCustomPrompt(BOND_PROMPT_TYPE, {
    // "Find the missing number: ? − 2 = −11", operators and numbers in the locale's glyphs.
    text: (p, _item, locale, band) => {
      const expr = p.data.expr as Expr;
      const rhs = Number(p.data.rhs);
      const eq = tokensText([...exprTokens(expr, locale), { t: 'op', s: getLocale(locale).ops['='] }, ...exprTokens(num(rhs), locale)]);
      return t(locale, 'balance.bondPrompt', { eq }, band);
    },
    validate: (p, item) => {
      const expr = p.data.expr as Expr;
      const fill = (e: Expr): Expr => (e.k === 'blank' ? num(toNumber(item.answer.value)) : e.k === 'op' ? { ...e, a: fill(e.a), b: fill(e.b) } : e);
      return evalExpr(fill(expr)) === Number(p.data.rhs) ? [] : ['the answer does not fill the blank'];
    },
  });
}

type BondForm = 'x+b' | 'x-b' | 'b+x' | 'x*a';
const BOND_FORMS: readonly BondForm[] = ['x+b', 'x-b', 'b+x', 'x*a'];
/** Every number on the line stays within ±BOND_MAX. */
const BOND_MAX = 20;

interface Bond {
  form: BondForm;
  /** The known number next to the blank (b or a), signed. */
  k: number;
  x: number;
  d: number;
  eq: Equation;
}

const signed = (r: Rng, lo: number, hi: number, pNeg: number): number => (r.chance(pNeg) ? -1 : 1) * r.int(lo, hi);

function sampleBond(r: Rng): Bond {
  for (;;) {
    const form = r.pick(BOND_FORMS);
    const x = signed(r, 1, 12, 0.4);
    let k: number;
    let eq: Equation;
    switch (form) {
      case 'x+b':
        k = r.int(1, 12);
        eq = eqn(1, k, 0, x + k);
        break;
      case 'x-b':
        k = r.int(1, 12);
        eq = eqn(1, -k, 0, x - k);
        break;
      case 'b+x':
        k = signed(r, 1, 12, 0.35);
        eq = eqn(1, k, 0, x + k);
        break;
      case 'x*a':
        k = r.chance(0.4) ? -r.int(2, 6) : r.int(2, 9);
        eq = eqn(k, 0, 0, k * x);
        break;
    }
    const d = eq.r.k;
    if (Math.abs(d) <= BOND_MAX) return { form, k, x, d, eq };
  }
}

function bondExpr(b: Bond): Expr {
  switch (b.form) {
    case 'x+b':
      return bin('+', BLANK, b.k);
    case 'x-b':
      return bin('-', BLANK, b.k);
    case 'b+x':
      return bin('+', b.k, BLANK);
    case 'x*a':
      return bin('*', BLANK, b.k);
  }
}

export const eqBondGen: GeneratorDef<Record<string, never>> = {
  id: 'eqBond',
  version: 1,
  capabilities: ['numberLine', 'numeric'],
  generate(level, rng) {
    const { value: b, level: lv } = pickByLevel(
      rng,
      level,
      sampleBond,
      (c) => scoreEquation('al.eq.onestep', equationFeatures(c.eq, solutionPath(c.eq, true) ?? [])),
      64,
    );
    const path = solutionPath(b.eq, true) ?? [];
    const additive = b.form !== 'x*a';
    const steps: SolutionStep[] = [];
    // Undo the known step: from the total back to the missing number.
    if (additive) steps.push({ k: 'hop', from: b.d, to: b.x });
    for (const m of path) {
      const { key: k, params } = describeMove(m, true);
      steps.push({ k: 'say', key: k, params });
    }
    steps.push({ k: 'say', key: BALANCE_SOL_KEYS.result, params: { x: b.x } });
    return {
      level: lv,
      prompt: { kind: 'custom', type: BOND_PROMPT_TYPE, data: { expr: bondExpr(b), rhs: b.d } },
      answer: { value: rat(b.x) },
      line: {
        min: -BOND_MAX,
        max: BOND_MAX,
        start: additive ? b.d : 0,
        major: 5,
        minor: 1,
        labelEvery: 5,
        steps: [1],
        answerMode: 'land',
      },
      solution: steps,
      misconceptions: balanceMisconceptions(b.eq),
      features: { ...equationFeatures(b.eq, path), form: BOND_FORMS.indexOf(b.form) },
    };
  },
};
