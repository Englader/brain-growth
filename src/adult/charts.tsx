/**
 * Minimal SVG charts for the adult dashboard, following the house mark specs:
 * bars ≤ 24px with 4px rounded data-ends and 2px gaps, 2px lines, ≥ 8px
 * markers with a 2px surface ring, hairline solid gridlines, one axis,
 * legend for ≥ 2 series plus direct end labels, hover/tap tooltips, text in
 * ink tokens (never the series colour). Colours are CSS roles (--series-1…)
 * validated for light and dark surfaces.
 */
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

function useWidth(): [{ current: HTMLDivElement | null }, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Ignore zero-width measurements (not yet laid out / hidden tab).
    const measure = (): void => {
      if (el.clientWidth > 0) setW(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

interface Tip {
  x: number;
  y: number;
  text: string;
}

function Tooltip({ tip }: { tip: Tip | null }): JSX.Element | null {
  if (!tip) return null;
  return (
    <div class="viz-tip" style={{ left: `${tip.x}px`, top: `${tip.y}px` }} role="status">
      {tip.text}
    </div>
  );
}

export function BarChart(props: {
  data: Array<{ label: string; value: number }>;
  format: (v: number) => string;
  ariaLabel: string;
  tickLabel?: (label: string, i: number) => string | null;
}): JSX.Element {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);
  const H = 160;
  const padL = 34;
  const padB = 22;
  const padT = 8;
  const max = niceMax(Math.max(...props.data.map((d) => d.value), 0));
  const slot = Math.max(1, (width - padL - 4) / Math.max(1, props.data.length));
  const barW = Math.max(2, Math.min(24, slot - 2));
  const y = (v: number): number => padT + (1 - v / max) * (H - padT - padB);
  const ticks = [0, max / 2, max];
  return (
    <div class="viz" ref={ref}>
      <svg width={width} height={H} role="img" aria-label={props.ariaLabel} onPointerLeave={() => setTip(null)}>
        {ticks.map((tv) => (
          <g>
            <line x1={padL} x2={width} y1={y(tv)} y2={y(tv)} class="viz-grid" />
            <text x={padL - 6} y={y(tv) + 4} class="viz-axis" text-anchor="end">
              {props.format(tv)}
            </text>
          </g>
        ))}
        {props.data.map((d, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          const top = y(d.value);
          const h = H - padB - top;
          const r = Math.min(4, barW / 2, h);
          const path =
            h <= 0
              ? ''
              : `M${x} ${H - padB}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + barW - r}Q${x + barW} ${top} ${x + barW} ${top + r}V${H - padB}Z`;
          const lbl = props.tickLabel?.(d.label, i);
          return (
            <g>
              {path && <path d={path} class="viz-bar" />}
              <rect
                x={padL + i * slot}
                y={padT}
                width={slot}
                height={H - padT - padB}
                fill="transparent"
                onPointerEnter={() => setTip({ x: x + barW / 2, y: top, text: `${d.label}: ${props.format(d.value)}` })}
                onClick={() => setTip({ x: x + barW / 2, y: top, text: `${d.label}: ${props.format(d.value)}` })}
              />
              {lbl && (
                <text x={x + barW / 2} y={H - 6} class="viz-axis" text-anchor="middle">
                  {lbl}
                </text>
              )}
            </g>
          );
        })}
        <line x1={padL} x2={width} y1={H - padB} y2={H - padB} class="viz-baseline" />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

export function StepLines(props: {
  series: Array<{ name: string; cls: string; values: number[] }>;
  labels: string[];
  ariaLabel: string;
}): JSX.Element {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 170;
  const padL = 30;
  const padR = 86;
  const padT = 10;
  const padB = 20;
  const n = props.labels.length;
  const max = niceMax(Math.max(1, ...props.series.flatMap((s) => s.values)));
  const x = (i: number): number => padL + (i / Math.max(1, n - 1)) * (width - padL - padR);
  const y = (v: number): number => padT + (1 - v / max) * (H - padT - padB);
  const path = (vals: number[]): string =>
    vals.map((v, i) => (i === 0 ? `M${x(0)} ${y(v)}` : `H${x(i)}V${y(v)}`)).join('');
  const onMove = (e: PointerEvent): void => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - padL) / (width - padL - padR)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  return (
    <div class="viz" ref={ref}>
      <div class="viz-legend">
        {props.series.map((s) => (
          <span>
            <i class={`lkey ${s.cls}`} /> {s.name}
          </span>
        ))}
      </div>
      <svg width={width} height={H} role="img" aria-label={props.ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {[0, max / 2, max].map((tv) => (
          <g>
            <line x1={padL} x2={width - padR} y1={y(tv)} y2={y(tv)} class="viz-grid" />
            <text x={padL - 6} y={y(tv) + 4} class="viz-axis" text-anchor="end">
              {Math.round(tv)}
            </text>
          </g>
        ))}
        {props.series.map((s) => {
          const last = s.values[s.values.length - 1] ?? 0;
          return (
            <g>
              <path d={path(s.values)} class={`viz-line ${s.cls}`} />
              <circle cx={x(n - 1)} cy={y(last)} r="4" class={`viz-dot ${s.cls}`} />
              <text x={x(n - 1) + 8} y={y(last) + 4} class="viz-label">
                {s.name} {last}
              </text>
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} class="viz-cross" />
            {props.series.map((s) => (
              <circle cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4" class={`viz-dot ${s.cls}`} />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div class="viz-tip" style={{ left: `${x(hover)}px`, top: '28px' }}>
          {props.labels[hover]}: {props.series.map((s) => `${s.name} ${s.values[hover] ?? 0}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

export function Reliability(props: {
  bins: Array<{ meanP: number; observed: number; n: number }>;
  labels: { predicted: string; observed: string };
  ariaLabel: string;
  pct: (v: number) => string;
}): JSX.Element {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);
  const size = Math.min(width, 300);
  const pad = 34;
  const s = (v: number): number => pad + v * (size - pad - 8);
  const sy = (v: number): number => size - pad - v * (size - pad - 8) + 8;
  return (
    <div class="viz" ref={ref}>
      <svg width={size} height={size} role="img" aria-label={props.ariaLabel} onPointerLeave={() => setTip(null)}>
        {[0, 0.5, 1].map((v) => (
          <g>
            <line x1={s(0)} x2={s(1)} y1={sy(v)} y2={sy(v)} class="viz-grid" />
            <text x={pad - 6} y={sy(v) + 4} class="viz-axis" text-anchor="end">
              {props.pct(v)}
            </text>
            <text x={s(v)} y={size - 10} class="viz-axis" text-anchor="middle">
              {props.pct(v)}
            </text>
          </g>
        ))}
        <line x1={s(0)} y1={sy(0)} x2={s(1)} y2={sy(1)} class="viz-ref" />
        {props.bins.map((b) => {
          const r = Math.max(4, Math.min(10, 3 + Math.sqrt(b.n)));
          const text = `${props.labels.predicted} ${props.pct(b.meanP)} · ${props.labels.observed} ${props.pct(b.observed)} · n=${b.n}`;
          return (
            <circle
              cx={s(b.meanP)}
              cy={sy(b.observed)}
              r={r}
              class="viz-dot series-1"
              onPointerEnter={() => setTip({ x: s(b.meanP), y: sy(b.observed) - r, text })}
              onClick={() => setTip({ x: s(b.meanP), y: sy(b.observed) - r, text })}
            />
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}
