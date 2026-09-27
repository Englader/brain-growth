/**
 * The number line — the game's central representation (Siegler & Ramani:
 * linear number boards build magnitude understanding).
 *
 *  PadsLine  (Band A): a scrollable row of big lily pads, one per position
 *                      (one per number, or one per k/den on a fraction line).
 *                      Pads are tappable; the frog auto-follows.
 *  RulerLine (B/C):    a full-width ruler showing magnitude, a live marker
 *                      that moves as digits are typed, tappable for estimates
 *                      and for exact picks (snapped to 1/den).
 *
 * Positions are an integer grid: tick k sits at k/den (den = 1 on whole-number
 * lines). Loops run over k, never by adding floats, so 1/3 + 1/3 + 1/3 is 1.
 */
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LineSpec } from '../../core/items/types';
import type { LocaleId } from '../../core/types';
import { getLocale } from '../../i18n/locales';
import { formatNumber, formatPercent } from '../../i18n/numbers';
import { lineValueText, numberText } from '../../i18n/render';
import './frac.css';
import { Frog, Marker } from './Frog';
import { Icon } from './Icon';

export const PAD = 64;
/** Minimum distance between the centres of two tick labels. */
export const MIN_LABEL_GAP = 28;

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

/** The line's integer grid: positions k/den for k in [k0, k1]. */
export interface Grid {
  den: number;
  k0: number;
  k1: number;
}

export function gridOf(line: LineSpec): Grid {
  const den = line.den ?? 1;
  return { den, k0: Math.round(line.min * den), k1: Math.round(line.max * den) };
}

/** Snap a position to the line's grid (and into the line). */
export function snapToLine(v: number, line: LineSpec): number {
  const { den, k0, k1 } = gridOf(line);
  return Math.min(k1, Math.max(k0, Math.round(v * den))) / den;
}

/** A label's parts: plain text, or a stacked fraction. */
export type LabelParts = { text: string } | { n: string; d: string };

/** How a position is written on this line (k/den unreduced on fraction lines: the ticks count parts). */
export function labelParts(k: number, line: LineSpec, locale: LocaleId): LabelParts {
  const conv = getLocale(locale).numbers;
  const den = line.den ?? 1;
  if (line.labelStyle === 'fraction' && k % den !== 0) {
    return { n: formatNumber(Math.abs(k), conv), d: formatNumber(den, conv) };
  }
  return { text: formatNumber(k / den, conv) };
}

const approxWidth = (p: LabelParts): number => ('text' in p ? p.text.length * 8 : Math.max(p.n.length, p.d.length) * 7 + 6);

/**
 * Stride (in grid steps) between labels: the line's labelEvery, widened until
 * neighbouring labels are at least MIN_LABEL_GAP px apart (and wide labels do
 * not touch). Prefers strides that divide the line so both ends stay labelled.
 */
export function labelStride(baseK: number, spanK: number, pxPerK: number, labelPx: number): number {
  const gap = Math.max(MIN_LABEL_GAP, labelPx + 6);
  // Not laid out yet (width 0): nothing to thin.
  if (!(pxPerK > 0) || baseK * pxPerK >= gap) return baseK;
  const n = Math.max(1, Math.round(spanK / baseK));
  const fits = (m: number): boolean => baseK * m * pxPerK >= gap;
  for (let m = 2; m <= n; m++) if (n % m === 0 && fits(m)) return baseK * m;
  // No divisor fits: the smallest stride that does (at most one label per line).
  return baseK * Math.max(2, Math.ceil(gap / (baseK * pxPerK)));
}

export interface RulerLabel {
  k: number;
  x: number;
  parts: LabelParts;
}

/** Tick labels of a ruler `width` px wide (padX on each side), thinned to MIN_LABEL_GAP. */
export function rulerLabels(line: LineSpec, locale: LocaleId, width: number, padX = 22): RulerLabel[] {
  const { den, k0, k1 } = gridOf(line);
  const pxPerK = (width - 2 * padX) / Math.max(1, k1 - k0);
  const baseK = Math.max(1, Math.round(line.labelEvery * den));
  // Rational lines also keep their (wider) labels from touching; whole-number lines
  // keep the spacing they always had (every such line is already ≥ 28 px at 360 px).
  const widest = line.den ? Math.max(approxWidth(labelParts(k0, line, locale)), approxWidth(labelParts(k1, line, locale))) : 0;
  const stride = labelStride(baseK, k1 - k0, pxPerK, widest);
  const out: RulerLabel[] = [];
  for (let k = Math.ceil(k0 / stride) * stride; k <= k1; k += stride) {
    out.push({ k, x: padX + (k - k0) * pxPerK, parts: labelParts(k, line, locale) });
  }
  return out;
}

/** Percent row of a double number line (labelStyle 'percent': max is 100 %), at the major ticks. */
export function percentLabels(line: LineSpec, locale: LocaleId, width: number, padX = 22): Array<{ x: number; text: string }> {
  const { den, k0, k1 } = gridOf(line);
  const pxPerK = (width - 2 * padX) / Math.max(1, k1 - k0);
  const kMajor = Math.max(1, Math.round(line.major * den));
  const conv = getLocale(locale).numbers;
  const pctOf = (k: number): number => Math.round(((k - k0) / (k1 - k0)) * 1000) / 10;
  const stride = labelStride(kMajor, k1 - k0, pxPerK, formatPercent(100, conv).length * 7.5);
  const out: Array<{ x: number; text: string }> = [];
  for (let k = k0; k <= k1; k += stride) out.push({ x: padX + (k - k0) * pxPerK, text: formatPercent(pctOf(k), conv) });
  return out;
}

/** A stacked fraction label for pads and buttons (HTML). */
export function StackedLabel({ parts, cls = '' }: { parts: LabelParts; cls?: string }): JSX.Element {
  if ('text' in parts) return <span class={cls}>{parts.text}</span>;
  return (
    <span class={`stacked ${cls}`}>
      <span class="stacked-n">{parts.n}</span>
      <span class="stacked-d">{parts.d}</span>
    </span>
  );
}

export function PadsLine(props: LineViewProps): JSX.Element {
  const { line, pos, lift, look, ghost, glow, onPick, pickable, locale, mood } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const { den, k0, k1 } = gridOf(line);
  const count = k1 - k0 + 1;
  const xOf = (v: number): number => (v * den - k0) * PAD + PAD / 2;
  const same = (a: number | null | undefined, v: number): boolean => a !== null && a !== undefined && Math.round(a * den) === Math.round(v * den);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = Math.max(0, xOf(pos) - el.clientWidth / 2);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: target, behavior: reduce ? 'auto' : 'smooth' });
  }, [Math.round(pos * den), line.min, line.max, den]);

  return (
    <div class="pads" ref={scroller}>
      <div class="pads-track" style={{ width: `${count * PAD}px` }}>
        <div class="pads-water" />
        {Array.from({ length: count }, (_, i) => {
          const k = k0 + i;
          const v = k / den;
          const cls = ['pad', same(glow, v) ? 'glow' : '', same(ghost, v) ? 'ghost' : '', same(line.flag, v) ? 'has-flag' : ''].join(' ');
          const parts = labelParts(k, line, locale);
          return (
            <button
              type="button"
              class={cls}
              style={{ left: `${i * PAD + 4}px`, '--pad': look.pad } as JSX.CSSProperties}
              disabled={!pickable}
              aria-label={lineValueText(v, line, locale)}
              onClick={() => onPick?.(v)}
            >
              <StackedLabel parts={parts} cls={'text' in parts && parts.text.length > 3 ? 'pad-num pad-num-long' : 'pad-num'} />
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
  const stacked = line.labelStyle === 'fraction';
  const pctRow = line.labelStyle === 'percent';
  const H = 132 + (stacked ? 10 : 0) + (pctRow ? 20 : 0);
  const baseY = 92;
  const padX = 22;
  const span = line.max - line.min;
  const { den, k0, k1 } = gridOf(line);
  const xOf = (v: number): number => padX + ((Math.min(line.max, Math.max(line.min, v)) - line.min) / span) * (width - 2 * padX);
  const pxPerK = (width - 2 * padX) / Math.max(1, k1 - k0);
  const kMinor = Math.max(1, Math.round(line.minor * den));
  const kMajor = Math.max(1, Math.round(line.major * den));
  const kStep = kMinor * pxPerK >= 4 ? kMinor : kMajor;

  const ticks: JSX.Element[] = [];
  for (let k = k0; k <= k1; k += kStep) {
    const major = k % kMajor === 0;
    const x = padX + (k - k0) * pxPerK;
    ticks.push(<line x1={x} x2={x} y1={baseY - (major ? 10 : 5)} y2={baseY + (major ? 10 : 5)} class={major ? 'tick major' : 'tick'} />);
  }
  const labels = rulerLabels(line, locale, width, padX).map(({ x, parts }) =>
    'text' in parts ? (
      <text x={x} y={baseY + (stacked ? 34 : 30)} class="tick-label" text-anchor="middle">
        {parts.text}
      </text>
    ) : (
      <g class="tick-frac">
        <text x={x} y={baseY + 26} text-anchor="middle">
          {parts.n}
        </text>
        <line x1={x - (Math.max(parts.n.length, parts.d.length) * 7 + 2) / 2} x2={x + (Math.max(parts.n.length, parts.d.length) * 7 + 2) / 2} y1={baseY + 30} y2={baseY + 30} />
        <text x={x} y={baseY + 43} text-anchor="middle">
          {parts.d}
        </text>
      </g>
    ),
  );
  const pcts = pctRow
    ? percentLabels(line, locale, width, padX).map(({ x, text }) => (
        <text x={x} y={baseY + 52} class="tick-label tick-pct" text-anchor="middle">
          {text}
        </text>
      ))
    : null;

  const onClick = (e: MouseEvent): void => {
    if (!pickable || !onPick) return;
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const v = line.min + ((x - padX) / (width - 2 * padX)) * span;
    onPick(line.den ? snapToLine(v, line) : Math.round(Math.min(line.max, Math.max(line.min, v))));
  };
  const hx = xOf(pos);
  return (
    <div class={`ruler${pickable ? ' pickable' : ''}`} ref={box}>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} onClick={onClick} dir="ltr">
        <line x1={padX} x2={width - padX} y1={baseY} y2={baseY} class="axis" />
        {ticks}
        {labels}
        {pcts}
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
            {/* An exact pick shows only where it lands; its value would give the answer away. */}
            {line.den ? (
              <circle cx={xOf(preview)} cy={baseY} r="6" class="preview-dot" />
            ) : (
              <text x={xOf(preview)} y={baseY - 68} text-anchor="middle">
                {numberText(preview, locale)}
              </text>
            )}
          </g>
        )}
      </svg>
      <div class="hopper ruler-hopper" style={{ transform: `translate(${hx - (look.kind === 'frog' ? 24 : 14)}px, ${baseY - (look.kind === 'frog' ? 46 : 14) - lift}px)` }}>
        {look.kind === 'frog' ? <Frog color={look.color} hat={look.hat} size={48} mood={mood ?? 'idle'} /> : <Marker />}
      </div>
      {/* Hop trails (worked solution, hint tier 2) above the hopper: a short hop on a wide
          scale (+10 on 0–300, 1/12 on 0–1) would otherwise hide under the frog. */}
      {trail && trail.length > 0 && (
        <svg class="ruler-overlay" width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true">
          {trail.map((h) => {
            const x1 = xOf(h.from);
            const x2 = xOf(h.to);
            const peak = Math.min(46, 14 + Math.abs(x2 - x1) * 0.35);
            const d = `M${x1} ${baseY - 4} Q${(x1 + x2) / 2} ${baseY - 4 - peak * 2} ${x2} ${baseY - 4}`;
            return (
              <g>
                <path d={d} class="trail-halo" />
                <path d={d} class="trail" />
              </g>
            );
          })}
          <circle cx={xOf(trail[trail.length - 1]!.to)} cy={baseY} r="6" class="trail-end" />
        </svg>
      )}
    </div>
  );
}
