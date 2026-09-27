/**
 * Balance scales. Every scale starts level (it IS in balance); a failed check
 * tips the scales that do not balance with the child's weights, toward the
 * heavier pan, and makes them glow. Band A: cubes to count and number pads
 * 0–10 for the one asked shape (tap to answer). Bands B/C: a weight block per
 * pan, and a chip per shape whose weight the digit pad types.
 */
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { numberText } from '../../../i18n/render';
import type { BalanceAnswer, BalancePuzzle, Pan, Scale } from '../../../puzzles';
import { allAssignments } from '../../../puzzles/types/balance';
import { Weight } from '../art';
import { DigitPad } from '../DigitPad';
import { editNumber, parseTyped, type BoardProps, type ViewDef } from './types';

type State = { w: Record<string, string>; sel: string; fresh: boolean };

const W = 320;
const H = 152;
const PIVOT = { x: 160, y: 40 };
const ARM = 96;
const DROP = 62;
const TRAY = 58;

interface Token {
  kind: 'shape' | 'cube' | 'block';
  id?: string;
  n?: number;
  w: number;
  h: number;
}

function tokens(pan: Pan, cubes: boolean): Token[] {
  const out: Token[] = [];
  for (const it of pan.shapes) for (let i = 0; i < it.count; i++) out.push({ kind: 'shape', id: it.shape, w: 26, h: 26 });
  if (pan.units > 0) {
    if (cubes) for (let i = 0; i < pan.units; i++) out.push({ kind: 'cube', w: 13, h: 13 });
    else out.push({ kind: 'block', n: pan.units, w: 40, h: 24 });
  }
  return out;
}

/** Pack tokens into rows (bottom row first) no wider than the tray. */
function layout(ts: Token[]): Array<{ t: Token; x: number; y: number }> {
  const rows: Token[][] = [[]];
  let width = 0;
  for (const t of ts) {
    if (width + t.w > TRAY * 2 - 6 && rows[rows.length - 1]!.length) {
      rows.push([]);
      width = 0;
    }
    rows[rows.length - 1]!.push(t);
    width += t.w + 2;
  }
  const out: Array<{ t: Token; x: number; y: number }> = [];
  let base = 0;
  for (const row of rows) {
    const rw = row.reduce((s, t) => s + t.w + 2, -2);
    let x = -rw / 2;
    const rh = Math.max(...row.map((t) => t.h));
    for (const t of row) {
      out.push({ t, x, y: base - t.h });
      x += t.w + 2;
    }
    base -= rh + 2;
  }
  return out;
}

function PanView({ pan, x, y, cubes, locale, mark }: { pan: Pan; x: number; y: number; cubes: boolean; locale: string; mark: boolean }): JSX.Element {
  return (
    <g transform={`translate(${x},${y})`} class={`pz-pan${mark ? ' mark' : ''}`}>
      <path d={`M${-TRAY} 0h${TRAY * 2}l-10 8h${-(TRAY * 2 - 20)}z`} class="tray" />
      {layout(tokens(pan, cubes)).map(({ t, x: tx, y: ty }) =>
        t.kind === 'shape' ? (
          <g transform={`translate(${tx},${ty - 1})`}>
            <Weight id={t.id!} size={26} />
          </g>
        ) : t.kind === 'cube' ? (
          <rect x={tx} y={ty - 1} width={12} height={12} rx={2} class="cube" />
        ) : (
          <g transform={`translate(${tx},${ty - 1})`}>
            <rect width={t.w} height={t.h} rx={5} class="block" />
            <text x={t.w / 2} y={t.h / 2 + 5} text-anchor="middle" class="block-n">
              {numberText(t.n!, locale)}
            </text>
          </g>
        ),
      )}
      <path d={`M${-TRAY + 4} 0L0 ${-DROP + 2}L${TRAY - 4} 0`} class="string" />
    </g>
  );
}

const weightOf = (pan: Pan, w: Record<string, number>): number =>
  pan.units + pan.shapes.reduce((s, it) => s + it.count * (w[it.shape] ?? 0), 0);

function ScaleView({ sc, i, marks, weights, cubes, locale }: { sc: Scale; i: number; marks: ReadonlySet<string>; weights: Record<string, number> | null; cubes: boolean; locale: string }): JSX.Element {
  const violated = marks.has(`scale:${i}`);
  const diff = violated && weights ? weightOf(sc.right, weights) - weightOf(sc.left, weights) : 0;
  const angle = (Math.sign(diff) * 9 * Math.PI) / 180;
  const dx = ARM * Math.cos(angle);
  const dy = ARM * Math.sin(angle);
  const L = { x: PIVOT.x - dx, y: PIVOT.y - dy };
  const R = { x: PIVOT.x + dx, y: PIVOT.y + dy };
  return (
    <svg class={`pz-scale${violated || marks.has(`scale:${i}`) ? ' mark' : ''}`} viewBox={`0 0 ${W} ${H}`} data-scale={i} aria-hidden="true">
      <path d={`M${PIVOT.x} ${PIVOT.y}L${PIVOT.x - 22} ${H - 4}h44z`} class="post" />
      <line x1={L.x} y1={L.y} x2={R.x} y2={R.y} class="beam" />
      <circle cx={PIVOT.x} cy={PIVOT.y} r={5} class="pin" />
      <PanView pan={sc.left} x={L.x} y={L.y + DROP} cubes={cubes} locale={locale} mark={marks.has(`pan:${i}:left`)} />
      <PanView pan={sc.right} x={R.x} y={R.y + DROP} cubes={cubes} locale={locale} mark={marks.has(`pan:${i}:right`)} />
    </svg>
  );
}

function entered(p: BalancePuzzle, s: State): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of p.ask) {
    const v = parseTyped(s.w[id] ?? '');
    if (Number.isFinite(v)) out[id] = v;
  }
  return out;
}

function Board(props: BoardProps<BalancePuzzle, State, BalanceAnswer>): JSX.Element {
  const { puzzle: p, state, update, marks, locked, locale, t, check, glow, band } = props;
  const bandA = band === 'A';
  // Weights for tipping a violated scale: the child's entries, and the reference weight of any shape not asked.
  const ref = useMemo(() => allAssignments(p)[0] ?? {}, [p]);
  const weights = { ...ref, ...entered(p, state) };
  const ask = p.ask[0]!;
  return (
    <div class="pz-balance">
      <div class="pz-scales">
        {p.scales.map((sc, i) => (
          <ScaleView sc={sc} i={i} marks={marks} weights={weights} cubes={bandA} locale={locale} />
        ))}
      </div>
      {bandA ? (
        <div class="pz-pads-a">
          <span class={`pz-ask${marks.has(`shape:${ask}`) ? ' mark' : ''}`}>
            <Weight id={ask} size={40} />
          </span>
          <div class="pz-pads">
            {Array.from({ length: p.max + 1 }, (_, v) => (
              <button
                type="button"
                class={`pz-pad${state.w[ask] === String(v) ? ' on' : ''}${glow && glow[ask] === v ? ' glow' : ''}`}
                data-pad={v}
                disabled={locked}
                onClick={() => {
                  const next = { ...state, w: { ...state.w, [ask]: String(v) } };
                  update(() => next);
                  check(next);
                }}
              >
                {numberText(v, locale)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div class="pz-chips" role="group" aria-label={t('puzzle.pickShape')}>
            {p.ask.map((id) => (
              <button
                type="button"
                class={`chip pz-chip${state.sel === id ? ' on' : ''}${marks.has(`shape:${id}`) ? ' mark' : ''}`}
                data-shape={id}
                aria-pressed={state.sel === id}
                aria-label={t('puzzle.weightOf', { n: p.ask.indexOf(id) + 1 })}
                disabled={locked}
                onClick={() => update((s) => ({ ...s, sel: id, fresh: true }))}
              >
                <Weight id={id} size={24} />
                <span class="pz-eq">=</span>
                <span class="pz-val">{state.w[id] || '?'}</span>
              </button>
            ))}
          </div>
          <DigitPad
            onKey={(k) =>
              update((s) => ({ ...s, fresh: false, w: { ...s.w, [s.sel]: editNumber(s.fresh && /\d/.test(k) ? '' : s.w[s.sel] ?? '', k, 3) } }))
            }
            onEnter={() => check()}
            disabled={locked}
            labels={{ backspace: t('play.backspace'), negative: t('play.negative') }}
          />
        </>
      )}
    </div>
  );
}

export const balanceView: ViewDef<BalancePuzzle, BalanceAnswer, State> = {
  init: (p) => ({ w: {}, sel: p.ask[0]!, fresh: true }),
  answer: (p, s) => entered(p, s),
  fromAnswer: (p, a) => ({ w: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v)])), sel: p.ask[0]!, fresh: true }),
  canCheck: (p, s) => Object.keys(entered(p, s)).length > 0,
  tapToCheck: (_p, band) => band === 'A',
  Board,
};
