/**
 * A tiny ICU-MessageFormat subset: {arg}, {n, plural, one {..} other {..}},
 * {g, select, f {..} other {..}}, '#' inside plural branches, and
 * {pct, percent}: a number already in percent units written with the
 * locale's percent convention ("25%" in English, "25 %" with a no-break
 * space in Macedonian; DESIGN §1.12). Messages never write `{x}%` themselves
 * (tests/i18n.test.ts), so every percentage goes through that convention.
 *
 * Why not i18next/FormatJS: those are 10-40 KB for features we do not use,
 * and Macedonian needs exactly two things from them — CLDR plural categories
 * (via Intl.PluralRules, built into every target browser) and gender select
 * for word problems ("баба ѝ" vs "баба му"). This file is the whole engine.
 */

type Node =
  | string
  | { t: 'arg'; name: string }
  | { t: 'hash' }
  | { t: 'pct'; name: string }
  | { t: 'plural'; name: string; offset: number; options: Record<string, Node[]> }
  | { t: 'select'; name: string; options: Record<string, Node[]> };

export type MessageParams = Record<string, string | number | undefined>;

export interface FormatEnv {
  pluralRules: Intl.PluralRules;
  formatNumber: (n: number) => string;
  /** `{x, percent}`: the locale's percent format (numbers.formatPercent); default `${number}%`. */
  formatPercent?: (n: number) => string;
}

class Parser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(): Node[] {
    const out = this.message(false, false);
    if (this.i < this.src.length) throw this.err('unexpected }');
    return out;
  }

  private err(msg: string): Error {
    return new SyntaxError(`${msg} at ${this.i} in "${this.src}"`);
  }

  private message(nested: boolean, inPlural: boolean): Node[] {
    const nodes: Node[] = [];
    let text = '';
    const flush = (): void => {
      if (text) nodes.push(text);
      text = '';
    };
    while (this.i < this.src.length) {
      const ch = this.src[this.i]!;
      if (ch === '}') {
        if (!nested) throw this.err('unbalanced }');
        break;
      }
      if (ch === '{') {
        flush();
        nodes.push(this.argument());
        continue;
      }
      if (ch === '#' && inPlural) {
        flush();
        nodes.push({ t: 'hash' });
        this.i++;
        continue;
      }
      text += ch;
      this.i++;
    }
    flush();
    return nodes;
  }

  private ws(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i]!)) this.i++;
  }

  private ident(): string {
    this.ws();
    const m = /^[=\w.-]+/.exec(this.src.slice(this.i));
    if (!m) throw this.err('expected identifier');
    this.i += m[0].length;
    this.ws();
    return m[0];
  }

  private expect(ch: string): void {
    if (this.src[this.i] !== ch) throw this.err(`expected ${ch}`);
    this.i++;
  }

  private argument(): Node {
    this.expect('{');
    const name = this.ident();
    if (this.src[this.i] === '}') {
      this.i++;
      return { t: 'arg', name };
    }
    this.expect(',');
    const kind = this.ident();
    if (kind === 'percent') {
      this.expect('}');
      return { t: 'pct', name };
    }
    if (kind !== 'plural' && kind !== 'select') throw this.err(`unknown format ${kind}`);
    this.expect(',');
    let offset = 0;
    this.ws();
    if (kind === 'plural' && this.src.startsWith('offset:', this.i)) {
      this.i += 'offset:'.length;
      offset = Number(this.ident());
    }
    const options: Record<string, Node[]> = {};
    for (;;) {
      this.ws();
      if (this.src[this.i] === '}') {
        this.i++;
        break;
      }
      const key = this.ident();
      this.expect('{');
      options[key] = this.message(true, kind === 'plural');
      this.expect('}');
    }
    if (!options.other) throw this.err(`${kind} without "other"`);
    return kind === 'plural' ? { t: 'plural', name, offset, options } : { t: 'select', name, options };
  }
}

const astCache = new Map<string, Node[]>();

export function compile(msg: string): Node[] {
  let ast = astCache.get(msg);
  if (!ast) {
    ast = new Parser(msg).parse();
    astCache.set(msg, ast);
  }
  return ast;
}

function render(nodes: Node[], params: MessageParams, env: FormatEnv, hashValue: number | null): string {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') {
      out += node;
    } else if (node.t === 'arg') {
      const v = params[node.name];
      out += v === undefined ? `{${node.name}}` : typeof v === 'number' ? env.formatNumber(v) : v;
    } else if (node.t === 'hash') {
      out += hashValue === null ? '#' : env.formatNumber(hashValue);
    } else if (node.t === 'pct') {
      // A number (or numeric string) in percent units; any other string is taken as already formatted.
      const v = params[node.name];
      const n = typeof v === 'number' ? v : v !== undefined && v.trim() !== '' ? Number(v) : NaN;
      if (v === undefined) out += `{${node.name}}`;
      else if (!Number.isFinite(n)) out += v;
      else out += env.formatPercent ? env.formatPercent(n) : `${env.formatNumber(n)}%`;
    } else if (node.t === 'plural') {
      const raw = Number(params[node.name] ?? 0);
      const n = raw - node.offset;
      const exact = node.options[`=${raw}`];
      const branch = exact ?? node.options[env.pluralRules.select(n)] ?? node.options.other!;
      out += render(branch, params, env, n);
    } else {
      const v = String(params[node.name] ?? 'other');
      out += render(node.options[v] ?? node.options.other!, params, env, hashValue);
    }
  }
  return out;
}

export function formatMessage(msg: string, params: MessageParams, env: FormatEnv): string {
  return render(compile(msg), params, env, null);
}

/** Argument names used by a message (for locale parity tests). */
export function argumentNames(msg: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: Node[]): void => {
    for (const n of nodes) {
      if (typeof n === 'string' || n.t === 'hash') continue;
      names.add(n.name);
      if (n.t === 'plural' || n.t === 'select') Object.values(n.options).forEach(walk);
    }
  };
  walk(compile(msg));
  return [...names].sort();
}
