/**
 * Visual prompts: dot patterns (dice / ten-frame / scattered), base-ten
 * blocks, equal groups and expressions. Everything here is legible without
 * reading, which is what Band A needs.
 */
import type { JSX } from 'preact';
import type { Expr, Prompt } from '../../core/items/types';
import { createRng } from '../../core/rng';
import type { LocaleId } from '../../core/types';
import { exprTokens } from '../../i18n/render';

const DICE: Record<number, Array<[number, number]>> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

export function Dots({ count, layout, label }: { count: number; layout: 'dice' | 'frame' | 'scatter'; label: string }): JSX.Element {
  if (layout === 'dice' && count <= 6) {
    return (
      <svg class="dots dice" viewBox="0 0 100 100" role="img" aria-label={label}>
        <rect x="4" y="4" width="92" height="92" rx="16" class="dice-face" />
        {DICE[count]!.map(([c, r]) => (
          <circle cx={22 + c * 28} cy={22 + r * 28} r="10" class="dot" />
        ))}
      </svg>
    );
  }
  if (layout === 'frame') {
    const frames = Math.max(1, Math.ceil(count / 10));
    return (
      <svg class="dots frame" viewBox={`0 0 110 ${frames * 50}`} role="img" aria-label={label}>
        {Array.from({ length: frames }, (_, f) => (
          <g transform={`translate(0 ${f * 50})`}>
            {Array.from({ length: 10 }, (_, i) => {
              const x = 5 + (i % 5) * 20;
              const y = 3 + Math.floor(i / 5) * 20;
              const filled = f * 10 + i < count;
              return (
                <g>
                  <rect x={x} y={y} width="20" height="20" class="frame-cell" />
                  {filled && <circle cx={x + 10} cy={y + 10} r="7" class="dot" />}
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    );
  }
  // Scattered: deterministic, non-overlapping positions.
  const rng = createRng(count * 7919);
  const pts: Array<[number, number]> = [];
  for (let tries = 0; pts.length < count && tries < 2000; tries++) {
    const x = rng.int(12, 148);
    const y = rng.int(12, 88);
    if (pts.every(([px, py]) => (px - x) ** 2 + (py - y) ** 2 > 22 ** 2)) pts.push([x, y]);
  }
  return (
    <svg class="dots scatter" viewBox="0 0 160 100" role="img" aria-label={label}>
      {pts.map(([x, y]) => (
        <circle cx={x} cy={y} r="8" class="dot" />
      ))}
    </svg>
  );
}

export function Blocks({ hundreds, tens, ones, label }: { hundreds: number; tens: number; ones: number; label: string }): JSX.Element {
  const flat = 44;
  const gap = 6;
  const width = hundreds * (flat + gap) + tens * 10 + (ones ? Math.ceil(ones / 5) * 10 + gap : 0) + 10;
  const h = 48;
  let x = 4;
  const parts: JSX.Element[] = [];
  for (let i = 0; i < hundreds; i++, x += flat + gap) {
    parts.push(
      <g transform={`translate(${x} 2)`}>
        <rect width={flat} height={flat} class="blk-flat" />
        {Array.from({ length: 9 }, (_, k) => (
          <path d={`M${(k + 1) * 4.4} 0V${flat}M0 ${(k + 1) * 4.4}H${flat}`} class="blk-grid" />
        ))}
      </g>,
    );
  }
  for (let i = 0; i < tens; i++, x += 10) {
    parts.push(
      <g transform={`translate(${x} 2)`}>
        <rect width="8" height={flat} class="blk-rod" />
        {Array.from({ length: 9 }, (_, k) => (
          <path d={`M0 ${(k + 1) * 4.4}H8`} class="blk-grid" />
        ))}
      </g>,
    );
  }
  x += gap;
  for (let i = 0; i < ones; i++) {
    parts.push(<rect x={x + Math.floor(i / 5) * 10} y={2 + (i % 5) * 9.2} width="8" height="8" class="blk-cube" />);
  }
  return (
    <svg class="blocks" viewBox={`0 0 ${Math.max(width, 40)} ${h}`} role="img" aria-label={label}>
      {parts}
    </svg>
  );
}

export function Groups({ groups, size, label }: { groups: number; size: number; label: string }): JSX.Element {
  const cell = 16;
  const boxW = Math.min(size, 3) * cell + 8;
  const rows = Math.ceil(size / 3);
  const boxH = rows * cell + 8;
  return (
    <svg class="groups" viewBox={`0 0 ${groups * (boxW + 8)} ${boxH + 4}`} role="img" aria-label={label}>
      {Array.from({ length: groups }, (_, g) => (
        <g transform={`translate(${g * (boxW + 8) + 2} 2)`}>
          <rect width={boxW} height={boxH} rx="8" class="group-box" />
          {Array.from({ length: size }, (_, i) => (
            <circle cx={4 + cell / 2 + (i % 3) * cell} cy={4 + cell / 2 + Math.floor(i / 3) * cell} r="5.5" class="dot" />
          ))}
        </g>
      ))}
    </svg>
  );
}

export function ExprView({ expr, rhs, locale }: { expr: Expr; rhs?: Expr | undefined; locale: LocaleId }): JSX.Element {
  const tokens = exprTokens(expr, locale);
  const rhsTokens = rhs ? exprTokens(rhs, locale) : null;
  const render = (tk: ReturnType<typeof exprTokens>[number], i: number): JSX.Element =>
    tk.t === 'blank' ? (
      <span key={i} class="expr-blank" aria-label="?">
        ?
      </span>
    ) : (
      <span key={i} class={`expr-${tk.t}`}>
        {tk.s}
      </span>
    );
  return (
    <div class="expr" dir="ltr">
      {tokens.map(render)}
      {rhsTokens && (
        <>
          <span class="expr-op">=</span>
          {rhsTokens.map(render)}
        </>
      )}
    </div>
  );
}

export function isVisualPrompt(p: Prompt): boolean {
  return p.kind === 'count' || p.kind === 'blocks' || p.kind === 'groups';
}
