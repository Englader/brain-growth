/**
 * The −6…6 coordinate plane. A tap anywhere snaps to the nearest lattice
 * point (the child then nudges with the arrows or confirms), so a lattice
 * cell of ~25 px at 360 px is still easy to hit: no need to land exactly on
 * the intersection.
 */
import type { JSX } from 'preact';
import { PLANE_MAX, snapToLattice, type Point } from '../../core/coord';
import type { LocaleId } from '../../core/types';
import { numberText } from '../../i18n/render';
import { useT } from '../../ui/hooks';

const SIZE = 280;
const M = 18;
const CELL = (SIZE - 2 * M) / (2 * PLANE_MAX);
const px = (v: number): number => M + (v + PLANE_MAX) * CELL;
const py = (v: number): number => M + (PLANE_MAX - v) * CELL;

export interface PlaneProps {
  locale: LocaleId;
  label: string;
  /** The child's point (plot task), or the point to read (read task). */
  dot: Point | null;
  /** A previous wrong answer (dashed). */
  ghost?: Point | null;
  /** The right point, shown after a wrong answer. */
  glow?: Point | null;
  onPick?: (p: Point) => void;
}

export function Plane(props: PlaneProps): JSX.Element {
  const t = useT();
  const ticks: number[] = [];
  for (let v = -PLANE_MAX; v <= PLANE_MAX; v++) ticks.push(v);
  const pick = (e: MouseEvent): void => {
    if (!props.onPick) return;
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * SIZE;
    const sy = ((e.clientY - r.top) / r.height) * SIZE;
    props.onPick(snapToLattice((sx - M) / CELL - PLANE_MAX, PLANE_MAX - (sy - M) / CELL));
  };
  const end = px(PLANE_MAX) + 8;
  return (
    <svg
      class={`plane${props.onPick ? ' pickable' : ''}`}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={props.label}
      onClick={pick}
    >
      {ticks.map((v) => (
        <g key={v}>
          <path class="pl-grid" d={`M${px(v)} ${py(PLANE_MAX)}V${py(-PLANE_MAX)}M${px(-PLANE_MAX)} ${py(v)}H${px(PLANE_MAX)}`} />
        </g>
      ))}
      <path class="pl-axis" d={`M${px(-PLANE_MAX) - 6} ${py(0)}H${end}M${end - 6} ${py(0) - 5}L${end} ${py(0)}L${end - 6} ${py(0) + 5}`} />
      <path class="pl-axis" d={`M${px(0)} ${py(-PLANE_MAX) + 6}V${M - 8}M${px(0) - 5} ${M - 2}L${px(0)} ${M - 8}L${px(0) + 5} ${M - 2}`} />
      {ticks
        .filter((v) => v !== 0 && v % 2 === 0)
        .map((v) => (
          <g key={`l${v}`}>
            <text class="pl-num" x={px(v)} y={py(0) + 12}>
              {numberText(v, props.locale)}
            </text>
            <text class="pl-num" x={px(0) - 9} y={py(v)}>
              {numberText(v, props.locale)}
            </text>
          </g>
        ))}
      <text class="pl-num" x={px(0) - 7} y={py(0) + 11}>
        {numberText(0, props.locale)}
      </text>
      <text class="pl-name" x={end - 4} y={py(0) - 10}>
        {t('coord.x')}
      </text>
      <text class="pl-name" x={px(0) + 12} y={M - 4}>
        {t('coord.y')}
      </text>
      {props.glow && <circle class="pl-glow" cx={px(props.glow.x)} cy={py(props.glow.y)} r={11} />}
      {props.ghost && <circle class="pl-ghost" cx={px(props.ghost.x)} cy={py(props.ghost.y)} r={8} />}
      {props.dot && <circle class="pl-dot" cx={px(props.dot.x)} cy={py(props.dot.y)} r={7} data-x={props.dot.x} data-y={props.dot.y} />}
    </svg>
  );
}

/** Where lattice point `p` sits inside a rendered plane, as fractions of its box (for e2e taps). */
export const planeFraction = (p: Point): { fx: number; fy: number } => ({ fx: px(p.x) / SIZE, fy: py(p.y) / SIZE });
