/**
 * Puzzle art: every puzzle id is drawn, never written. Shapes differ in form
 * AND colour, so they stay distinct for colour-blind children and in the dark
 * Band C theme. Ids come from the puzzle core (tiles t0–t7, balance shapes
 * b0–b5, cryptarithm symbols s0–s9, logic items a*, b*, c*).
 */
import type { JSX } from 'preact';

export type ShapeKind = 'circle' | 'square' | 'triangle' | 'star' | 'heart' | 'diamond' | 'hexagon' | 'cross' | 'moon' | 'drop';

const PATH: Record<ShapeKind, string> = {
  circle: 'M12 3a9 9 0 110 18 9 9 0 010-18z',
  square: 'M4 4h16v16H4z',
  triangle: 'M12 3l10 18H2z',
  star: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2l-6.1 3.4 1.4-6.8L2.2 9.1l6.9-.8z',
  heart: 'M12 21S2.5 15 2.5 8.6A4.8 4.8 0 0112 6.3a4.8 4.8 0 019.5 2.3C21.5 15 12 21 12 21z',
  diamond: 'M12 2l9 10-9 10-9-10z',
  hexagon: 'M7 3h10l5 9-5 9H7l-5-9z',
  cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  drop: 'M12 2s7 8.3 7 12.5a7 7 0 01-14 0C5 10.3 12 2 12 2z',
};

/** Colour-blind-safe categorical fills, readable on light and dark themes. */
const COLORS = ['#d64545', '#2a78d6', '#eda100', '#8b5cf6', '#e87ba4', '#0e9aa7', '#1baf7a', '#eb6834', '#94a3b8', '#38bdf8'];

const TILE: Array<[ShapeKind, number]> = [
  ['circle', 0], ['square', 1], ['triangle', 2], ['star', 3], ['heart', 4], ['diamond', 5], ['hexagon', 6], ['cross', 7],
];
const BALANCE: Array<[ShapeKind, number]> = [
  ['circle', 7], ['square', 5], ['triangle', 3], ['star', 2], ['heart', 4], ['diamond', 6],
];
const SYMBOL: Array<[ShapeKind, number]> = [
  ['circle', 0], ['square', 1], ['triangle', 2], ['star', 3], ['heart', 4], ['diamond', 5], ['hexagon', 6], ['cross', 7], ['moon', 9], ['drop', 8],
];
const LOGIC_C: Array<[ShapeKind, number]> = [['circle', 1], ['triangle', 7], ['square', 6], ['star', 3]];

function Shape({ kind, color, size }: { kind: ShapeKind; color: string; size: number }): JSX.Element {
  return (
    <svg class="glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATH[kind]} fill={color} stroke="rgba(0,0,0,0.35)" stroke-width="1" stroke-linejoin="round" />
    </svg>
  );
}

const indexOf = (id: string): number => Number(id.slice(1)) || 0;

/** Pattern tile t0–t7. */
export function Tile({ id, size = 32 }: { id: string; size?: number }): JSX.Element {
  const [kind, c] = TILE[indexOf(id) % TILE.length]!;
  return <Shape kind={kind} color={COLORS[c]!} size={size} />;
}

/** Balance shape b0–b5. */
export function Weight({ id, size = 24 }: { id: string; size?: number }): JSX.Element {
  const [kind, c] = BALANCE[indexOf(id) % BALANCE.length]!;
  return <Shape kind={kind} color={COLORS[c]!} size={size} />;
}

/** Cryptarithm symbol s0–s9. */
export function Sym({ id, size = 28 }: { id: string; size?: number }): JSX.Element {
  const [kind, c] = SYMBOL[indexOf(id) % SYMBOL.length]!;
  return <Shape kind={kind} color={COLORS[c]!} size={size} />;
}

/** Friend faces for logic-grid anchors (a0–a3). */
function Friend({ i, size }: { i: number; size: number }): JSX.Element {
  const fill = ['#2a78d6', '#eb6834', '#1baf7a', '#e87ba4'][i % 4]!;
  const ears = i % 4 === 1 ? 'M5 7l2-5 3 4zM19 7l-2-5-3 4z' : i % 4 === 3 ? 'M6 8a3 3 0 11-1-5M18 8a3 3 0 101-5' : '';
  return (
    <svg class="glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {ears && <path d={ears} fill={fill} stroke="rgba(0,0,0,0.35)" stroke-width="1" />}
      <circle cx="12" cy="13" r="9" fill={fill} stroke="rgba(0,0,0,0.35)" stroke-width="1" />
      <circle cx="9" cy="11.5" r="1.4" fill="#10303d" />
      <circle cx="15" cy="11.5" r="1.4" fill="#10303d" />
      <path d={i % 2 ? 'M9 16h6' : 'M8.5 15.5q3.5 3 7 0'} stroke="#10303d" stroke-width="1.6" fill="none" stroke-linecap="round" />
    </svg>
  );
}

/** Things for logic-grid category b (b0–b3): kite, gift, ball, flag. */
const THINGS = [
  'M12 2l6 8-6 9-6-9zM12 19l-2 3',
  'M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0',
  'M12 3a9 9 0 110 18 9 9 0 010-18zM3.5 9c5 2 12 2 17 0M3.5 15c5-2 12-2 17 0',
  'M6 21V3M6 3h11l-2 4 2 4H6',
];
const THING_FILL = ['#eda100', '#e87ba4', '#1baf7a', '#d64545'];

function Thing({ i, size }: { i: number; size: number }): JSX.Element {
  return (
    <svg class="glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={THINGS[i % 4]!} fill={THING_FILL[i % 4]!} fill-opacity={0.55} stroke={THING_FILL[i % 4]!} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  );
}

/** Logic-grid item: anchors (a*) are friends, b* things, c* shapes. */
export function Item({ id, size = 28 }: { id: string; size?: number }): JSX.Element {
  const i = indexOf(id);
  if (id[0] === 'a') return <Friend i={i} size={size} />;
  if (id[0] === 'b') return <Thing i={i} size={size} />;
  const [kind, c] = LOGIC_C[i % LOGIC_C.length]!;
  return <Shape kind={kind} color={COLORS[c]!} size={size} />;
}

/** "Same" (=) or "not the same" (≠) drawn as SVG: ≠ is not in the font subsets. */
export function Relation({ same, size = 22 }: { same: boolean; size?: number }): JSX.Element {
  return (
    <svg class={`relation ${same ? 'same' : 'diff'}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9h14M5 15h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      {!same && <path d="M16 4L8 20" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />}
    </svg>
  );
}

/** Grid marks: a tick for "goes together", a cross for "does not". */
export function Mark({ yes, size = 20 }: { yes: boolean; size?: number }): JSX.Element {
  return (
    <svg class={`tick ${yes ? 'yes' : 'no'}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={yes ? 'M5 12l5 5 9-10' : 'M6 6l12 12M18 6L6 18'} stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** Any puzzle id, drawn with the right family. */
export function Glyph({ id, size }: { id: string; size?: number }): JSX.Element {
  switch (id[0]) {
    case 't':
      return <Tile id={id} size={size} />;
    case 's':
      return <Sym id={id} size={size} />;
    case 'b':
      // b* is a balance shape in balance puzzles and a thing in logic grids; callers pick Weight or Item.
      return <Weight id={id} size={size} />;
    default:
      return <Item id={id} size={size} />;
  }
}
