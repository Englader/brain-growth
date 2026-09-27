/**
 * Cryptarithm: a column addition written in shapes. Each shape is a digit;
 * the same shape is always the same digit, different shapes are different
 * digits, and no number starts with 0. Pick a shape's chip and type its digit
 * (the next empty shape is picked for you). Given digits are fixed.
 */
import type { JSX } from 'preact';
import { getLocale } from '../../../i18n/locales';
import type { CryptAnswer, CryptPuzzle } from '../../../puzzles';
import { Sym } from '../art';
import { DigitPad } from '../DigitPad';
import { parseTyped, type BoardProps, type ViewDef } from './types';

type State = { d: Record<string, string>; sel: string | null };

const open = (p: CryptPuzzle): string[] => p.symbols.filter((s) => !(s in p.given));

function digitOf(p: CryptPuzzle, s: State, sym: string): string {
  return sym in p.given ? String(p.given[sym]) : s.d[sym] ?? '';
}

function Board(props: BoardProps<CryptPuzzle, State, CryptAnswer>): JSX.Element {
  const { puzzle: p, state, update, marks, locked, locale, t, check } = props;
  const L = p.sum.length;
  const rows = [...p.addends, p.sum];
  const symMarked = (sym: string): boolean => ['sym', 'missing', 'distinct', 'lead'].some((k) => marks.has(`${k}:${sym}`));
  return (
    <div class="pz-crypt">
      <div class="pz-sum" style={{ gridTemplateColumns: `repeat(${L + 1}, 40px)` }} role="img" aria-label={t('puzzle.ask.crypt')}>
        {rows.map((w, r) => {
          const isSum = r === rows.length - 1;
          const cells: JSX.Element[] = isSum ? [<span class="pz-rule" />] : [];
          cells.push(<span class="pz-op">{r === rows.length - 2 ? getLocale(locale).ops['+'] : ''}</span>);
          for (let c = L - 1; c >= 0; c--) {
            const sym = w[w.length - 1 - c];
            cells.push(
              <span class={`pz-digit${marks.has(`col:${c}`) ? ' col-mark' : ''}${sym && symMarked(sym) ? ' mark' : ''}`}>
                {sym && (
                  <>
                    <Sym id={sym} size={28} />
                    <small class={sym in p.given ? 'given' : ''}>{digitOf(p, state, sym) || ' '}</small>
                  </>
                )}
              </span>,
            );
          }
          return cells;
        })}
      </div>
      <div class="pz-chips" role="group" aria-label={t('puzzle.pickSymbol')}>
        {p.symbols.map((sym, i) => {
          const given = sym in p.given;
          return (
            <button
              type="button"
              class={`chip pz-chip${state.sel === sym ? ' on' : ''}${given ? ' given' : ''}${symMarked(sym) ? ' mark' : ''}`}
              data-sym={sym}
              aria-pressed={state.sel === sym}
              aria-label={t('puzzle.symbol', { n: i + 1 })}
              disabled={locked || given}
              onClick={() => update((s) => ({ ...s, sel: sym }))}
            >
              <Sym id={sym} size={22} />
              <span class="pz-eq">=</span>
              <span class="pz-val">{digitOf(p, state, sym) || '?'}</span>
            </button>
          );
        })}
      </div>
      <DigitPad
        onKey={(k) =>
          update((s) => {
            if (!s.sel) return s;
            const d = { ...s.d };
            if (k === 'back') delete d[s.sel];
            else if (/^\d$/.test(k)) d[s.sel] = k;
            else return s;
            const rest = open(p).filter((x) => x !== s.sel && d[x] === undefined);
            return { d, sel: /^\d$/.test(k) && rest.length ? rest[0]! : s.sel };
          })
        }
        onEnter={() => check()}
        disabled={locked}
        labels={{ backspace: t('play.backspace'), negative: t('play.negative') }}
      />
    </div>
  );
}

export const cryptView: ViewDef<CryptPuzzle, CryptAnswer, State> = {
  init: (p) => ({ d: {}, sel: open(p)[0] ?? null }),
  answer: (p, s) => {
    const out: CryptAnswer = { ...p.given };
    for (const sym of open(p)) {
      const v = parseTyped(s.d[sym] ?? '');
      if (Number.isFinite(v)) out[sym] = v;
    }
    return out;
  },
  fromAnswer: (p, a) => ({ d: Object.fromEntries(open(p).map((s) => [s, String(a[s])])), sel: null }),
  canCheck: (p, s) => open(p).some((sym) => s.d[sym] !== undefined),
  Board,
};
