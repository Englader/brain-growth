/**
 * Estimation range: set two handles on a ruler so the true value is inside,
 * no wider than allowed. Drag a handle, tap the ruler to move the whole range
 * there, or pick an end and type it. A failed check only ever says "not inside
 * yet" or "too wide": never which way, so the child estimates instead of
 * homing in by trial.
 */
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { numberText } from '../../../i18n/render';
import { getLocale } from '../../../i18n/locales';
import type { EstimateAnswer, EstimatePuzzle, Quantity } from '../../../puzzles';
import { DigitPad } from '../DigitPad';
import { editNumber, parseTyped, type BoardProps, type ViewDef } from './types';

type End = 'lo' | 'hi';
type State = { lo: string; hi: string; sel: End; fresh: boolean };

const VW = 320;
const VH = 96;
const X0 = 18;
const X1 = VW - 18;
const AXIS = 58;

function QuantityView({ q, locale, t }: { q: Quantity; locale: string; t: BoardProps<EstimatePuzzle, State, EstimateAnswer>['t'] }): JSX.Element {
  const ops = getLocale(locale).ops;
  const n = (x: number): string => numberText(x, locale);
  if (q.kind === 'percent') return <p class="pz-quantity">{t('puzzle.percentOf', { pct: q.pct, of: q.of })}</p>;
  const text =
    q.kind === 'sum' ? q.terms.map(n).join(` ${ops['+']} `) : `${n(q.a)} ${q.kind === 'product' ? ops['*'] : ops['/']} ${n(q.b)}`;
  return <p class="pz-quantity">{text}</p>;
}

const num = (s: string, fallback: number): number => {
  const v = parseTyped(s);
  return Number.isFinite(v) ? v : fallback;
};

function Board(props: BoardProps<EstimatePuzzle, State, EstimateAnswer>): JSX.Element {
  const { puzzle: p, state, update, marks, locked, locale, t, check } = props;
  const { min, max, major, snap } = p.ruler;
  const lo = num(state.lo, min);
  const hi = num(state.hi, min);
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  const x = (v: number): number => X0 + ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (X1 - X0);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<End | 'band' | null>(null);
  const bandW = useRef(0);

  const valueAt = (clientX: number): number => {
    const r = svg.current!.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * VW;
    const v = min + ((vx - X0) / (X1 - X0)) * (max - min);
    return Math.min(max, Math.max(min, Math.round(v / snap) * snap));
  };
  const moveTo = (clientX: number): void => {
    const v = valueAt(clientX);
    const d = drag.current;
    if (d === 'lo' || d === 'hi') update((s) => ({ ...s, [d]: String(v), sel: d, fresh: true }));
    else if (d === 'band') {
      const w = bandW.current;
      let l = Math.round((v - w / 2) / snap) * snap;
      l = Math.min(max - w, Math.max(min, l));
      update((s) => ({ ...s, lo: String(l), hi: String(l + w), fresh: true }));
    }
  };
  const down = (e: PointerEvent): void => {
    if (locked) return;
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * VW;
    const near = (v: number): boolean => Math.abs(px - x(v)) <= 18;
    drag.current = near(lo) && (!near(hi) || Math.abs(px - x(lo)) <= Math.abs(px - x(hi))) ? 'lo' : near(hi) ? 'hi' : 'band';
    bandW.current = Math.max(0, b - a);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    moveTo(e.clientX);
  };

  const ticks: number[] = [];
  for (let v = min; v <= max + 1e-9; v += major) ticks.push(v);
  const labelEvery = ticks.length > 7 ? 2 : 1;
  const flagged = marks.has('below') || marks.has('above') || marks.has('wide') || marks.has('outside');
  const width = b - a;
  return (
    <div class="pz-estimate">
      <QuantityView q={p.q} locale={locale} t={t} />
      <svg
        ref={svg}
        class={`pz-ruler${locked ? '' : ' live'}`}
        viewBox={`0 0 ${VW} ${VH}`}
        role="img"
        aria-label={t('puzzle.range', { lo: numberText(a, locale), hi: numberText(b, locale) })}
        onPointerDown={down}
        onPointerMove={(e) => drag.current && moveTo(e.clientX)}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <rect x={x(a)} y={AXIS - 16} width={Math.max(2, x(b) - x(a))} height={32} rx={8} class={`band${flagged ? ' mark' : ''}`} />
        <line x1={X0} y1={AXIS} x2={X1} y2={AXIS} class="axis" />
        {ticks.map((v, i) => (
          <g>
            <line x1={x(v)} y1={AXIS - 7} x2={x(v)} y2={AXIS + 7} class="tick" />
            {i % labelEvery === 0 && (
              <text x={x(v)} y={AXIS + 26} text-anchor="middle" class="tick-label">
                {numberText(v, locale)}
              </text>
            )}
          </g>
        ))}
        {(['lo', 'hi'] as const).map((end) => {
          const v = end === 'lo' ? lo : hi;
          return (
            <g class={`handle${state.sel === end ? ' on' : ''}`}>
              <line x1={x(v)} y1={AXIS - 24} x2={x(v)} y2={AXIS + 12} />
              <circle cx={x(v)} cy={AXIS - 24} r={9} />
            </g>
          );
        })}
      </svg>
      <p class={`pz-width${marks.has('wide') ? ' mark' : ''}`}>{t('puzzle.width', { w: numberText(width, locale), max: numberText(p.maxWidth, locale) })}</p>
      <div class="pz-chips" role="group">
        {(['lo', 'hi'] as const).map((end) => (
          <button
            type="button"
            class={`chip pz-chip${state.sel === end ? ' on' : ''}`}
            data-end={end}
            aria-pressed={state.sel === end}
            disabled={locked}
            onClick={() => update((s) => ({ ...s, sel: end, fresh: true }))}
          >
            <span class="pz-end">{end === 'lo' ? t('puzzle.from') : t('puzzle.to')}</span>
            <span class="pz-val">{state[end] || '?'}</span>
          </button>
        ))}
      </div>
      <DigitPad
        onKey={(k) => update((s) => ({ ...s, fresh: false, [s.sel]: editNumber(s.fresh && /\d/.test(k) ? '' : s[s.sel], k, 7) }))}
        onEnter={() => check()}
        disabled={locked}
        labels={{ backspace: t('play.backspace'), negative: t('play.negative') }}
      />
    </div>
  );
}

export const estimateView: ViewDef<EstimatePuzzle, EstimateAnswer, State> = {
  // Start with the allowed width at the left end of the ruler: it never holds the truth (width < truth).
  init: (p) => ({ lo: String(p.ruler.min), hi: String(p.ruler.min + p.maxWidth), sel: 'lo', fresh: true }),
  answer: (_p, s) => [parseTyped(s.lo), parseTyped(s.hi)],
  fromAnswer: (_p, a) => ({ lo: String(a[0]), hi: String(a[1]), sel: 'lo', fresh: true }),
  canCheck: (_p, s) => Number.isFinite(parseTyped(s.lo)) && Number.isFinite(parseTyped(s.hi)),
  Board,
};
