// @vitest-environment jsdom
/** Target board rendering: stacked fractions, locale glyphs, "other ways" order. */
import { render } from 'preact';
import { describe, expect, it } from 'vitest';
import { rat } from '../src/core/rational';
import { canonicalKey, leaf, node, parseRepr } from '../src/core/target/expr';
import { Expr, Num } from '../src/modes/target/Num';
import { OtherWays } from '../src/modes/target/OtherWays';

describe('Target rendering', () => {
  it('draws a non-integer as a stacked fraction with the locale minus, never a decimal', () => {
    const root = document.createElement('div');
    render(<Num v={rat(-3, 4)} locale="mk" />, root);
    expect(root.querySelector('.tfrac')?.getAttribute('aria-label')).toBe('−3/4');
    expect(root.querySelector('.tfrac-sign')?.textContent).toBe('−');
    expect(root.querySelector('.tfrac-n')?.textContent).toBe('3');
    expect(root.querySelector('.tfrac-d')?.textContent).toBe('4');
    render(<Num v={rat(24)} locale="mk" />, root);
    expect(root.textContent).toBe('24');
    expect(root.querySelector('.tfrac')).toBeNull();
  });

  it('renders an expression with the locale glyphs and minimal brackets', () => {
    const root = document.createElement('div');
    render(<Expr e={node('/', 6, node('-', 1, leaf(rat(3, 4))))} locale="mk" result={rat(24)} />, root);
    const ops = [...root.querySelectorAll('.texpr-op')].map((e) => e.textContent);
    expect(ops).toEqual([':', '−', '=']);
    expect([...root.querySelectorAll('.texpr-paren')].map((e) => e.textContent)).toEqual(['(', ')']);
    expect(root.querySelectorAll('.tfrac')).toHaveLength(1);
    render(<Expr e={node('-', node('*', 3, 4), 2)} locale="en" />, root);
    expect(root.textContent).toBe('3×4−2');
    expect(root.querySelector('.texpr-paren')).toBeNull();
  });

  it('lists the ways the child found first, ticked', () => {
    const ways = ['(6*4)', '((6-4)*(3*4))', '((6+3)+(4*4))'];
    const found = new Set([canonicalKey(parseRepr('(4*(4+3))+6')!) ?? '', canonicalKey(parseRepr(ways[2]!)!) ?? '']);
    const root = document.createElement('div');
    render(<OtherWays ways={ways} total={3} found={found} target={rat(24)} locale="en" />, root);
    const rows = [...root.querySelectorAll('.tways-list li')];
    expect(rows).toHaveLength(3);
    expect(rows[0]!.classList.contains('found')).toBe(true);
    expect(rows[0]!.querySelector('svg[role="img"]')).not.toBeNull();
    expect(rows.slice(1).every((r) => !r.classList.contains('found'))).toBe(true);
  });
});
