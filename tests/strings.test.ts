/**
 * No hard-coded UI text: every word a child or adult reads comes from the
 * locale bundles (both languages, same keys). Scans every .tsx file under
 * src/ui, src/modes and src/adult (feature directories included) for
 *  - literal JSX text containing a letter, and
 *  - literal values containing a letter in aria-label, title, placeholder,
 *    alt and aria-valuetext attributes (direct strings, template text,
 *    either branch of a conditional).
 * Digits, maths glyphs and punctuation (e.g. " — ", "/", "%") are allowed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const DIRS = ['src/ui', 'src/modes', 'src/adult'];
const TEXT_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext']);
const LETTER = /\p{L}/u;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Literal text an attribute value would render (not strings passed to calls like t('key')). */
function literalParts(e: ts.Expression): string[] {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isTemplateExpression(e)) return [e.head.text, ...e.templateSpans.map((s) => s.literal.text)];
  if (ts.isParenthesizedExpression(e)) return literalParts(e.expression);
  if (ts.isConditionalExpression(e)) return [...literalParts(e.whenTrue), ...literalParts(e.whenFalse)];
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.PlusToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    return [...literalParts(e.left), ...literalParts(e.right)];
  }
  return [];
}

export function hardcodedText(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const where = (n: ts.Node): string => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n) && LETTER.test(n.text)) out.push(`${where(n)} text "${n.text.trim()}"`);
    if (ts.isJsxAttribute(n) && TEXT_ATTRS.has(n.name.getText(sf)) && n.initializer) {
      const init = n.initializer;
      const parts = ts.isStringLiteral(init) ? [init.text] : ts.isJsxExpression(init) && init.expression ? literalParts(init.expression) : [];
      for (const p of parts) if (LETTER.test(p)) out.push(`${where(n)} ${n.name.getText(sf)}="${p}"`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('no hard-coded UI strings', () => {
  it('src/ui, src/modes, src/adult render text only through the locale bundles', () => {
    const found = DIRS.flatMap((d) => tsxFiles(join(ROOT, d))).flatMap((f) => hardcodedText(relative(ROOT, f), readFileSync(f, 'utf8')));
    expect(found).toEqual([]);
  });

  it('catches literal text and attributes, allows keys, numbers and glyphs', () => {
    const src = `const A = () => (<div aria-label="Close" title={ok ? 'Yes' : t('x')}>
      Hello {n}/{m} — {t('home.play')}
      <b aria-label={\`\${n} items\`}>{'?'} 12 + 3 = 15</b>
      <i title={t('a.b')} aria-label={x ?? 'Menu'} />
    </div>);`;
    const got = hardcodedText('x.tsx', src);
    expect(got).toHaveLength(5);
    expect(got.join('\n')).toMatch(/aria-label="Close"/);
    expect(got.join('\n')).toMatch(/title="Yes"/);
    expect(got.join('\n')).toMatch(/text "Hello/);
    expect(got.join('\n')).toMatch(/aria-label=" items"/);
    expect(got.join('\n')).toMatch(/aria-label="Menu"/);
  });
});
