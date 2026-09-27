/**
 * Pattern: "what comes next?". Band A: a row of picture tiles and a palette of
 * the tiles used; tapping one answers (no text anywhere). Bands B/C: number
 * sequences answered on the digit pad. Hints light up the repeating unit, the
 * groups of a growing row, or the gaps/ratios between neighbouring numbers.
 */
import type { JSX } from 'preact';
import { rat } from '../../../core/rational';
import { numberText } from '../../../i18n/render';
import { getLocale } from '../../../i18n/locales';
import type { PatternAnswer, PatternPuzzle } from '../../../puzzles';
import { Tile } from '../art';
import { DigitPad } from '../DigitPad';
import { editNumber, parseTyped, type BoardProps, type ViewDef } from './types';

type State = { pick: string | null; typed: string };

function groupOf(marks: ReadonlySet<string>, i: number): boolean {
  for (const m of marks) {
    const g = /^group:(\d+)-(\d+)$/.exec(m);
    if (g && i >= Number(g[1]) && i <= Number(g[2])) return true;
  }
  return false;
}

function signed(n: number, locale: string): string {
  const ops = getLocale(locale).ops;
  return n < 0 ? `${ops['-']}${numberText(-n, locale)}` : `${ops['+']}${numberText(n, locale)}`;
}

function ratioText(a: number, b: number, locale: string): string {
  const ops = getLocale(locale).ops;
  const r = rat(b, a);
  const sign = r.n < 0 ? ops['-'] : '';
  const n = Math.abs(r.n);
  if (r.d === 1) return `${ops['*']}${sign}${numberText(n, locale)}`;
  if (n === 1) return `${ops['/']}${sign}${numberText(r.d, locale)}`;
  return `${ops['*']}${sign}${numberText(n, locale)}/${numberText(r.d, locale)}`;
}

function Board(props: BoardProps<PatternPuzzle, State, PatternAnswer>): JSX.Element {
  const { puzzle: p, state, update, marks, locked, locale, t, check, glow } = props;
  if (p.kind === 'tiles') {
    // One row, as big as the phone allows (a pattern should not wrap).
    const cell = Math.min(52, Math.floor(328 / (p.seq.length + 1)) - 3);
    const tile = cell - 8;
    return (
      <div class="pz-pattern pz-tiles">
        <div class="pz-row" role="img" aria-label={t('puzzle.ask.patternTiles')} style={{ '--cell': `${cell}px` }}>
          {p.seq.map((id, i) => (
            <span class={`pz-cell${marks.has(`pos:${i}`) ? ' mark' : ''}${groupOf(marks, i) ? ' group' : ''}`}>
              <Tile id={id} size={tile} />
            </span>
          ))}
          <span class={`pz-cell slot${marks.has('next') ? ' mark' : ''}${state.pick ? ' filled' : ''}`}>
            {state.pick ? <Tile id={state.pick} size={tile} /> : <span class="slot-q">?</span>}
          </span>
        </div>
        <div class="pz-palette">
          {p.palette.map((id, i) => (
            <button
              type="button"
              class={`pz-choice${state.pick === id ? ' on' : ''}${glow === id ? ' glow' : ''}`}
              data-tile={id}
              aria-label={t('puzzle.tile', { n: i + 1 })}
              disabled={locked}
              onClick={() => {
                const next = { ...state, pick: id };
                update(() => next);
                check(next);
              }}
            >
              <Tile id={id} size={60} />
            </button>
          ))}
        </div>
      </div>
    );
  }
  const seq = p.seq;
  const showGaps = marks.has('gaps');
  const showRatios = marks.has('ratios');
  return (
    <div class="pz-pattern pz-numbers">
      <div class="pz-seq">
        {seq.map((v, i) => (
          <>
            <span class={`pz-num${marks.has(`pos:${i}`) ? ' mark' : ''}`}>{numberText(v, locale)}</span>
            {i < seq.length - 1 && (showGaps || showRatios) && (
              <span class="pz-gap">{showRatios ? ratioText(v, seq[i + 1]!, locale) : signed(seq[i + 1]! - v, locale)}</span>
            )}
          </>
        ))}
        <span class={`pz-num slot${marks.has('next') ? ' mark' : ''}`} aria-live="polite">
          {state.typed || '?'}
        </span>
      </div>
      <DigitPad
        onKey={(k) => update((s) => ({ ...s, typed: editNumber(s.typed, k) }))}
        onEnter={() => check()}
        allowNegative={props.band === 'C'}
        disabled={locked}
        labels={{ backspace: t('play.backspace'), negative: t('play.negative') }}
      />
    </div>
  );
}

export const patternView: ViewDef<PatternPuzzle, PatternAnswer, State> = {
  init: () => ({ pick: null, typed: '' }),
  answer: (p, s) => (p.kind === 'tiles' ? s.pick ?? '' : parseTyped(s.typed)),
  fromAnswer: (p, a) => (p.kind === 'tiles' ? { pick: String(a), typed: '' } : { pick: null, typed: String(a).replace('-', '−') }),
  canCheck: (p, s) => (p.kind === 'tiles' ? s.pick !== null : Number.isFinite(parseTyped(s.typed))),
  tapToCheck: (p) => p.kind === 'tiles',
  Board,
};
