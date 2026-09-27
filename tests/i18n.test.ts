/**
 * Localisation guarantees, enforced in CI:
 *  - every locale has every key, with the same placeholders (and parseable ICU)
 *  - every skill, achievement, cosmetic, misconception, flag, quest and
 *    wildcard id has its strings; secrets have no hints
 *  - word-problem banks match structurally across locales
 *  - every glyph any locale can render exists in the band's self-hosted font,
 *    inside the unicode-range of the file that carries it (no silent fallback)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../src/core/achievements';
import { FLAGS, flagLabelKey } from '../src/core/flags';
import { WILDCARDS } from '../src/core/league';
import { QUEST_TEMPLATES } from '../src/core/quests';
import { COSMETICS } from '../src/core/rewards/cosmetics';
import { SKILLS } from '../src/core/skills';
import { allGenerators } from '../src/core/items/generators';
import { argumentNames, compile } from '../src/i18n/format';
import { tk } from '../src/i18n/i18n';
import { allLocales, getLocale } from '../src/i18n/locales';
import { createRng } from '../src/core/rng';
import { GRAPH } from '../src/core/skills';

const locales = allLocales();
const en = getLocale('en');

describe('locale parity', () => {
  for (const loc of locales) {
    it(`${loc.id}: same keys as en, same placeholders, valid ICU`, () => {
      const missing = Object.keys(en.messages).filter((k) => !(k in loc.messages));
      const extra = Object.keys(loc.messages).filter((k) => !(k in en.messages));
      expect(missing, 'missing keys').toEqual([]);
      expect(extra, 'extra keys').toEqual([]);
      for (const [k, v] of Object.entries(loc.messages)) {
        expect(() => compile(v), `${loc.id}:${k}`).not.toThrow();
        expect(v.trim().length, `${loc.id}:${k} empty`).toBeGreaterThan(0);
        expect(argumentNames(v), `${loc.id}:${k} placeholders`).toEqual(argumentNames(en.messages[k]!));
      }
    });
  }

  it('word-problem banks have the same templates and slots in every locale', () => {
    for (const loc of locales) {
      expect(Object.keys(loc.wordProblems.templates).sort()).toEqual(Object.keys(en.wordProblems.templates).sort());
      // Numeric slots must match exactly; `name` and `g` (grammatical gender) are helpers every
      // template may use or ignore — Macedonian needs gender where English does not.
      const slots = (tpl: string): string[] => argumentNames(tpl).filter((a) => a !== 'name' && a !== 'g');
      for (const [id, tpl] of Object.entries(loc.wordProblems.templates)) {
        expect(slots(tpl), `${loc.id}:${id}`).toEqual(slots(en.wordProblems.templates[id]!));
        expect(argumentNames(tpl).every((a) => ['a', 'b', 'name', 'g'].includes(a)), `${loc.id}:${id}`).toBe(true);
      }
      expect(loc.wordProblems.names.some((n) => n.g === 'f') && loc.wordProblems.names.some((n) => n.g === 'm')).toBe(true);
    }
  });

  it('every word-problem template referenced by a skill exists', () => {
    for (const s of SKILLS) for (const g of s.gens ?? []) {
      if (g.id === 'word') expect(en.wordProblems.templates[String(g.config?.template)], s.id).toBeDefined();
    }
  });
});

describe('locale bundles (loaded on demand in the app)', () => {
  it('are all in for these tests, so parity is never checked over an empty bundle', () => {
    for (const loc of locales) {
      expect(loc.loaded, loc.id).toBe(true);
      expect(Object.keys(loc.messages).length, loc.id).toBeGreaterThan(500);
      expect(Object.keys(loc.wordProblems.templates).length, loc.id).toBeGreaterThan(0);
    }
  });
});

describe('percentages use the locale percent format (DESIGN §1.12)', () => {
  it('no string writes a sign after a placeholder: every percentage is {x, percent}', () => {
    for (const loc of locales) {
      const bad = Object.entries(loc.messages).filter(([, v]) => /\}[\s ]*%/.test(v));
      expect(bad.map(([k, v]) => `${loc.id}:${k} ${v}`)).toEqual([]);
      expect(Object.values(loc.messages).filter((v) => v.includes('}%'))).toEqual([]);
    }
  });

  it('a literal percent follows the convention: "10%" in English, "10 %" with a no-break space in Macedonian', () => {
    const odd = (loc: string, re: RegExp): string[] =>
      Object.entries(getLocale(loc).messages)
        .filter(([, v]) => v.replace(/\{\w+, percent\}/g, '').replace(re, '').includes('%'))
        .map(([k, v]) => `${loc}:${k} ${v}`);
    expect(odd('en', /\d%/g)).toEqual([]);
    expect(odd('mk', /\d %/g)).toEqual([]);
  });

  it('{x, percent} renders through the locale config', () => {
    expect(tk('en', 'results.accuracy', { pct: 25 })).toBe('First-try accuracy: 25%');
    expect(tk('mk', 'results.accuracy', { pct: 25 })).toBe('Точност од прв обид: 25 %');
    expect(tk('mk', 'adult.errors.expected', { e: 12.5, o: 40 })).toContain('12,5 %');
    expect(tk('en', 'frac.pctOf', { pct: 75, of: 80 })).toBe('75% of 80');
  });
});

describe('band letters', () => {
  it('Macedonian names the bands А, Б, В: never the Latin A, B, C (which look alike but read differently)', () => {
    const latin = Object.entries(getLocale('mk').messages).filter(([, v]) => /груп[аи]\s+[ABC]\b|\b[ABC]\s+и\s+[ABC]\b|\b[ABC]\/[ABC]\b/.test(v));
    expect(latin.map(([k, v]) => `${k} ${v}`)).toEqual([]);
  });
});

describe('content ids have strings', () => {
  const has = (k: string): boolean => k in en.messages;
  it('skills', () => expect(SKILLS.map((s) => `skill.${s.id}`).filter((k) => !has(k))).toEqual([]));
  it('achievements (name + desc; hint unless secret; secrets never hint)', () => {
    for (const a of ACHIEVEMENTS) {
      expect(has(`ach.${a.id}.name`), a.id).toBe(true);
      expect(has(`ach.${a.id}.desc`), a.id).toBe(true);
      expect(has(`ach.${a.id}.hint`), a.id).toBe(!a.secret);
    }
  });
  it('cosmetics', () => expect(COSMETICS.map((c) => `cos.${c.id}`).filter((k) => !has(k))).toEqual([]));
  it('flags (labelKey, default flag.<id>)', () => expect(FLAGS.map(flagLabelKey).filter((k) => !has(k))).toEqual([]));
  it('quests', () => expect(QUEST_TEMPLATES.map((q) => q.id).filter((k) => !has(k))).toEqual([]));
  it('wildcards', () => expect(WILDCARDS.map((w) => `family.wild.${w}`).filter((k) => !has(k))).toEqual([]));

  it('every misconception code and solution key a generator can emit', () => {
    const mis = new Set<string>();
    const sols = new Set<string>();
    for (const s of GRAPH.playableSkills()) {
      for (const b of s.gens ?? []) {
        const gen = allGenerators().find((g) => g.id === b.id)!;
        for (let i = 0; i < 60; i++) {
          const item = gen.generate(i / 59, createRng(i + 1), b.config ?? {});
          item.misconceptions.forEach((m) => mis.add(m.code));
          item.solution.forEach((st) => st.k === 'say' && sols.add(st.key));
        }
      }
    }
    expect([...mis].filter((c) => !has(`mis.${c}.name`) || !has(`mis.${c}.tip`))).toEqual([]);
    expect([...sols].filter((k) => !has(k))).toEqual([]);
  });
});

// ── fonts ────────────────────────────────────────────────────────────────
interface Face {
  family: string;
  file: string;
  ranges: Array<[number, number]>;
}

function parseFaces(css: string): Face[] {
  const faces: Face[] = [];
  for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const family = /font-family:\s*'([^']+)'/.exec(block)![1]!;
    const file = /url\(['"]?([^'")]+)['"]?\)/.exec(block)![1]!;
    const rangeStr = /unicode-range:\s*([^;]+);/.exec(block)![1]!;
    const ranges = rangeStr.split(',').map((r) => {
      const [a, b] = r.trim().replace(/^U\+/i, '').split('-');
      return [parseInt(a!, 16), parseInt(b ?? a!, 16)] as [number, number];
    });
    faces.push({ family, file, ranges });
  }
  return faces;
}

describe('self-hosted fonts cover every glyph we render', () => {
  const cssPath = resolve(__dirname, '../src/styles/fonts.css');
  const css = readFileSync(cssPath, 'utf8');
  const faces = parseFaces(css);
  const fonts = new Map(faces.map((f) => [f.file, fontkit.openSync(resolve(__dirname, '../src/styles', f.file)) as fontkit.Font]));

  const glyphsFor = (): Set<number> => {
    const chars = new Set<number>();
    const add = (s: string): void => {
      for (const ch of s) chars.add(ch.codePointAt(0)!);
    };
    for (const loc of locales) {
      Object.values(loc.messages).forEach(add);
      Object.values(loc.wordProblems.templates).forEach(add);
      loc.wordProblems.names.forEach((n) => add(n.n));
      Object.values(loc.ops).forEach(add);
      add(loc.numbers.decimal + loc.numbers.group + loc.numbers.minus + '0123456789%()?' + loc.short + loc.nativeName);
    }
    // ICU syntax characters are not rendered.
    for (const c of '{}#') chars.delete(c.codePointAt(0)!);
    return chars;
  };

  for (const family of new Set(faces.map((f) => f.family))) {
    it(`${family}`, () => {
      const missing: string[] = [];
      for (const cp of glyphsFor()) {
        if (cp === 0x20 || cp === 0x0a) continue;
        const face = faces.find((f) => f.family === family && f.ranges.some(([a, b]) => cp >= a && cp <= b));
        const ok = face && fonts.get(face.file)!.hasGlyphForCodePoint(cp);
        if (!ok) missing.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')} '${String.fromCodePoint(cp)}'`);
      }
      expect(missing).toEqual([]);
    });
  }
});
