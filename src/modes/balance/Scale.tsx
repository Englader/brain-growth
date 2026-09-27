/**
 * The pan scale. Each pan shows x-boxes, "10" weights and unit weights; in
 * Band C a negative amount is balloons pulling the pan up (x-balloons for a
 * negative x-term). The beam is level: every legal move keeps it level, and a
 * refused one-pan move tips it for a moment (`tip`).
 *
 * Tapping an item asks to take it off that ONE pan: the mode refuses it as
 * `unbalanced` and says why. That is the teaching moment, not an error.
 */
import type { JSX } from 'preact';
import type { BalanceMove, Equation, Pan } from '../../core/balance';
import { scaleView } from '../../core/balance';
import { useT } from '../../ui/hooks';

type Kind = 'x' | 'ten' | 'unit' | 'xBalloon' | 'tenBalloon' | 'balloon';
type Side = 'left' | 'right';

interface Piece {
  kind: Kind;
  w: number;
  h: number;
}

const BASE: Record<Kind, { w: number; h: number }> = {
  x: { w: 22, h: 22 },
  ten: { w: 26, h: 18 },
  unit: { w: 11, h: 11 },
  xBalloon: { w: 20, h: 20 },
  tenBalloon: { w: 22, h: 22 },
  balloon: { w: 16, h: 16 },
};

/** The one-pan move a tap on this piece asks for (always refused as unbalanced). */
function tapMove(kind: Kind, side: Side): BalanceMove {
  switch (kind) {
    case 'x':
      return { op: 'sub', term: 'x', n: 1, side };
    case 'ten':
      return { op: 'sub', term: 'k', n: 10, side };
    case 'unit':
      return { op: 'sub', term: 'k', n: 1, side };
    case 'xBalloon':
      return { op: 'add', term: 'x', n: 1, side };
    case 'tenBalloon':
      return { op: 'add', term: 'k', n: 10, side };
    case 'balloon':
      return { op: 'add', term: 'k', n: 1, side };
  }
}

/** A pan's pieces in groups (x-terms, weights, balloons); each group starts a new row. */
function pieces(p: Pan): Piece[][] {
  const v = scaleView({ l: p, r: p }).left;
  const group = (...runs: Array<[Kind, number]>): Piece[] =>
    runs.flatMap(([kind, n]) => Array.from({ length: n }, () => ({ kind, ...BASE[kind] })));
  return [
    group(['x', v.xBoxes]),
    group(['ten', Math.floor(v.units / 10)], ['unit', v.units % 10]),
    group(['xBalloon', v.xBalloons]),
    group(['tenBalloon', Math.floor(v.balloons / 10)], ['balloon', v.balloons % 10]),
  ].filter((g) => g.length > 0);
}

const PAN_W = 100;
const FLOOR = 152;
const ROOM = 96;
const GAP = 3;

/** Flow pieces into rows from the tray upwards, shrinking them if the stack would not fit. */
function layout(groups: Piece[][]): Array<Piece & { x: number; y: number; s: number }> {
  for (let s = 1; s > 0.3; s -= 0.1) {
    const out: Array<Piece & { x: number; y: number; s: number }> = [];
    let y = FLOOR;
    for (const g of groups) {
      let x = 0;
      let rowH = 0;
      for (const p of g) {
        const w = p.w * s;
        const h = p.h * s;
        if (x > 0 && x + w > PAN_W) {
          y -= rowH + GAP;
          x = 0;
          rowH = 0;
        }
        out.push({ ...p, x, y: y - h, s });
        x += w + GAP;
        rowH = Math.max(rowH, h);
      }
      y -= rowH + GAP;
    }
    if (FLOOR - y <= ROOM) return out;
  }
  const flat = groups.flat();
  return flat.map((p, i) => ({ ...p, x: (i % 10) * 10, y: FLOOR - 10 - Math.floor(i / 10) * 10, s: 0.3 }));
}

export interface ScaleProps {
  eq: Equation;
  /** Tip the beam for a moment: the side that goes down. */
  tip: Side | null;
  label: string;
  /** Highlight x: it stands alone. */
  isolated: boolean;
  /** Tap a piece: a one-pan move (refused). Absent = not tappable. */
  onTap?: (m: BalanceMove) => void;
}

export function Scale(props: ScaleProps): JSX.Element {
  const t = useT();
  const unknown = t('balance.var');
  const deg = props.tip === 'left' ? -6 : props.tip === 'right' ? 6 : 0;
  const pan = (p: Pan, side: Side, cx: number): JSX.Element => {
    const left = cx - PAN_W / 2;
    const items = layout(pieces(p));
    return (
      <g class={`sc-pan sc-${side}`}>
        <path class="sc-string" d={`M${cx} 36L${cx - 56} 156M${cx} 36L${cx + 56} 156`} />
        <path class="sc-tray" d={`M${cx - 58} 156Q${cx} 174 ${cx + 58} 156Z`} />
        {items
          .filter((it) => it.kind === 'xBalloon' || it.kind === 'tenBalloon' || it.kind === 'balloon')
          .map((it) => {
            const r = (it.w * it.s) / 2;
            return <path class="sc-tie" d={`M${left + it.x + r} ${it.y + 2 * r}L${left + it.x + r} 156`} />;
          })}
        {items.map((it, i) => {
          const x = left + it.x;
          const w = it.w * it.s;
          const h = it.h * it.s;
          const tap = props.onTap ? () => props.onTap!(tapMove(it.kind, side)) : undefined;
          const common = {
            key: i,
            class: `sc-piece sc-${it.kind}${props.isolated && it.kind === 'x' ? ' sc-alone' : ''}`,
            'data-piece': it.kind,
            'data-side': side,
            role: tap ? ('button' as const) : undefined,
            tabIndex: tap ? 0 : undefined,
            'aria-label': tap ? t('balance.takeOne') : undefined,
            onClick: tap,
          };
          if (it.kind === 'x' || it.kind === 'ten' || it.kind === 'unit') {
            return (
              <g {...common}>
                <rect x={x} y={it.y} width={w} height={h} rx={it.kind === 'unit' ? 2 : 4} />
                {it.kind !== 'unit' && (
                  <text x={x + w / 2} y={it.y + h / 2} font-size={(it.kind === 'x' ? 15 : 10) * it.s}>
                    {it.kind === 'x' ? unknown : '10'}
                  </text>
                )}
              </g>
            );
          }
          const r = w / 2;
          return (
            <g {...common}>
              <circle cx={x + r} cy={it.y + r} r={r} />
              {it.kind !== 'balloon' && (
                <text x={x + r} y={it.y + r} font-size={(it.kind === 'xBalloon' ? 13 : 9) * it.s}>
                  {it.kind === 'xBalloon' ? unknown : '10'}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  };
  return (
    <svg class="scale" viewBox="0 0 320 196" role="group" aria-label={props.label}>
      <path class="sc-post" d="M160 36V186M120 188H200" />
      <g class="sc-beam-g" style={{ transform: `rotate(${deg}deg)`, transformOrigin: '160px 36px' }}>
        <path class="sc-beam" d="M26 36H294" />
        {pan(props.eq.l, 'left', 62)}
        {pan(props.eq.r, 'right', 258)}
      </g>
      <circle class="sc-pivot" cx="160" cy="36" r="6" />
    </svg>
  );
}
