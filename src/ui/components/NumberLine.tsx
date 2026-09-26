/**
 * The number line — the game's central representation (Siegler & Ramani:
 * linear number boards build magnitude understanding).
 *
 *  PadsLine  (Band A): a scrollable row of big lily pads, one per number.
 *                      Pads are tappable; the frog auto-follows.
 *  RulerLine (B/C):    a full-width ruler showing magnitude, a live marker
 *                      that moves as digits are typed, tappable for estimates.
 */
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LineSpec } from '../../core/items/types';
import type { LocaleId } from '../../core/types';
import { numberText } from '../../i18n/render';
import { Frog, Marker } from './Frog';
import { Icon } from './Icon';

export const PAD = 64;

export interface HopperLook {
  kind: 'frog' | 'marker';
  color: string;
  hat?: string | undefined;
  pad: string;
}

export interface LineViewProps {
  line: LineSpec;
  locale: LocaleId;
  pos: number;
  lift: number;
  look: HopperLook;
  ghost?: number | null;
  glow?: number | null;
  preview?: number | null;
  trail?: Array<{ from: number; to: number }>;
  onPick?: (value: number) => void;
  pickable?: boolean;
  mood?: 'idle' | 'happy' | 'think';
}

export function PadsLine(props: LineViewProps): JSX.Element {
  const { line, pos, lift, look, ghost, glow, onPick, pickable, locale, mood } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const count = line.max - line.min + 1;
  const xOf = (v: number): number => (v - line.min) * PAD + PAD / 2;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = Math.max(0, xOf(pos) - el.clientWidth / 2);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: target, behavior: reduce ? 'auto' : 'smooth' });
  }, [Math.round(pos), line.min, line.max]);

  return (
    <div class="pads" ref={scroller}>
      <div class="pads-track" style={{ width: `${count * PAD}px` }}>
        <div class="pads-water" />
        {Array.from({ length: count }, (_, i) => {
          const v = line.min + i;
          const cls = ['pad', v === glow ? 'glow' : '', v === ghost ? 'ghost' : '', v === line.flag ? 'has-flag' : ''].join(' ');
          return (
            <button
              type="button"
              class={cls}
              style={{ left: `${i * PAD + 4}px`, '--pad': look.pad } as JSX.CSSProperties}
              disabled={!pickable}
              aria-label={numberText(v, locale)}
              onClick={() => onPick?.(v)}
            >
              <span class="pad-num">{numberText(v, locale)}</span>
            </button>
          );
        })}
        {line.flag !== undefined && (
          <div class="flag" style={{ left: `${xOf(line.flag) + 10}px` }} aria-hidden="true">
            <Icon name="flag" size={30} />
          </div>
        )}
        <div class="hopper" style={{ transform: `translate(${xOf(pos) - 34}px, ${-lift}px)` }}>
          <Frog color={look.color} hat={look.hat} size={68} mood={mood ?? 'idle'} />
        </div>
      </div>
    </div>
  );
}

function useWidth(ref: { current: HTMLElement | null }): number {
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return w;
}

export function RulerLine(props: LineViewProps): JSX.Element {
  const { line, pos, lift, look, ghost, preview, trail, onPick, pickable, locale, glow, mood } = props;
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const H = 132;
  const baseY = 92;
  const padX = 22;
  const span = line.max - line.min;
  const xOf = (v: number): number => padX + ((Math.min(line.max, Math.max(line.min, v)) - line.min) / span) * (width - 2 * padX);
  const minorPx = (line.minor / span) * (width - 2 * padX);
  const ticks: JSX.Element[] = [];
  const step = minorPx >= 4 ? line.minor : line.major;
  for (let v = line.min; v <= line.max + 1e-9; v += step) {
    const vv = Math.round(v * 1e6) / 1e6;
    const major = Math.abs(vv / line.major - Math.round(vv / line.major)) < 1e-9;
    const labeled = Math.abs(vv / line.labelEvery - Math.round(vv / line.labelEvery)) < 1e-9;
    const x = xOf(vv);
    ticks.push(<line x1={x} x2={x} y1={baseY - (major ? 10 : 5)} y2={baseY + (major ? 10 : 5)} class={major ? 'tick major' : 'tick'} />);
    if (labeled) {
      ticks.push(
        <text x={x} y={baseY + 30} class="tick-label" text-anchor="middle">
          {numberText(vv, locale)}
        </text>,
      );
    }
  }
  const onClick = (e: MouseEvent): void => {
    if (!pickable || !onPick) return;
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const v = line.min + ((x - padX) / (width - 2 * padX)) * span;
    onPick(Math.round(Math.min(line.max, Math.max(line.min, v))));
  };
  const hx = xOf(pos);
  return (
    <div class={`ruler${pickable ? ' pickable' : ''}`} ref={box}>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} onClick={onClick} dir="ltr">
        <line x1={padX} x2={width - padX} y1={baseY} y2={baseY} class="axis" />
        {ticks}
        {trail?.map((h) => {
          const x1 = xOf(h.from);
          const x2 = xOf(h.to);
          const peak = Math.min(46, 14 + Math.abs(x2 - x1) * 0.35);
          return <path d={`M${x1} ${baseY - 4} Q${(x1 + x2) / 2} ${baseY - 4 - peak * 2} ${x2} ${baseY - 4}`} class="trail" />;
        })}
        {line.flag !== undefined && (
          <g transform={`translate(${xOf(line.flag) - 2} ${baseY - 40})`} class="flag-svg">
            <path d="M2 40V2h18l-5 7 5 7H2" />
          </g>
        )}
        {glow !== null && glow !== undefined && <circle cx={xOf(glow)} cy={baseY} r="11" class="glow-dot" />}
        {ghost !== null && ghost !== undefined && <circle cx={xOf(ghost)} cy={baseY} r="8" class="ghost-dot" />}
        {preview !== null && preview !== undefined && (
          <g class="preview">
            <line x1={xOf(preview)} x2={xOf(preview)} y1={baseY - 64} y2={baseY + 12} />
            <text x={xOf(preview)} y={baseY - 68} text-anchor="middle">
              {numberText(preview, locale)}
            </text>
          </g>
        )}
      </svg>
      <div class="hopper ruler-hopper" style={{ transform: `translate(${hx - (look.kind === 'frog' ? 24 : 14)}px, ${baseY - (look.kind === 'frog' ? 46 : 14) - lift}px)` }}>
        {look.kind === 'frog' ? <Frog color={look.color} hat={look.hat} size={48} mood={mood ?? 'idle'} /> : <Marker />}
      </div>
    </div>
  );
}
