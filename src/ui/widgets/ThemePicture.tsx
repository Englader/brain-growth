/**
 * One picture per weekly theme (pure SVG, no text), so a pre-reader can tell
 * this week's challenge by sight: dice dots for counting, a ten-frame for
 * make-ten, a bridge for crossing ten, a domino double, tens rods, a
 * two-arch bridge for crossing a hundred, a times-table array, big blocks, a
 * number line with a hop, a line dipping below the water, and confetti for
 * the mixed week.
 */
import type { JSX } from 'preact';

const TILE: Record<string, string> = {
  counting: '#ede9fe',
  bonds: '#ffe4e6',
  bridgeTen: '#cffafe',
  doubles: '#ecfccb',
  tens: '#fef3c7',
  bridgeHundred: '#fce7f3',
  tables: '#e0e7ff',
  bigNumbers: '#ccfbf1',
  numberLine: '#e0f2fe',
  belowZero: '#dbeafe',
  mixed: '#fae8ff',
};

const dot = (cx: number, cy: number, r: number, fill: string): JSX.Element => <circle cx={cx} cy={cy} r={r} fill={fill} />;

function Art({ id }: { id: string }): JSX.Element {
  switch (id) {
    case 'counting':
      return (
        <g>
          <rect x="14" y="14" width="36" height="36" rx="8" fill="#fff" stroke="#7c3aed" stroke-width="3" />
          {dot(23, 23, 3.6, '#7c3aed')}
          {dot(41, 23, 3.6, '#7c3aed')}
          {dot(32, 32, 3.6, '#7c3aed')}
          {dot(23, 41, 3.6, '#7c3aed')}
          {dot(41, 41, 3.6, '#7c3aed')}
        </g>
      );
    case 'bonds':
      return (
        <g>
          <rect x="8" y="20" width="48" height="24" rx="4" fill="#fff" stroke="#e11d48" stroke-width="2.5" />
          <path d="M17.6 20v24M27.2 20v24M36.8 20v24M46.4 20v24M8 32h48" stroke="#e11d48" stroke-width="1.5" />
          {[12.8, 22.4, 32, 41.6, 51.2].map((x, i) => dot(x, 26, 3.4, i < 5 ? '#e11d48' : '#fff'))}
          {[12.8, 22.4, 32, 41.6, 51.2].map((x, i) => dot(x, 38, 3.4, i < 2 ? '#e11d48' : '#fda4af'))}
        </g>
      );
    case 'bridgeTen':
      return (
        <g>
          <path d="M6 44h52v12H6z" fill="#67e8f9" />
          <path d="M6 30h52" stroke="#0e7490" stroke-width="4" stroke-linecap="round" />
          <path d="M12 44V33a20 16 0 0140 0v11" fill="none" stroke="#0e7490" stroke-width="4" />
          <path d="M22 30v-6M32 30v-8M42 30v-6" stroke="#0e7490" stroke-width="3" stroke-linecap="round" />
          {dot(32, 14, 5, '#0e7490')}
        </g>
      );
    case 'doubles':
      return (
        <g>
          <rect x="10" y="18" width="44" height="28" rx="6" fill="#fff" stroke="#4d7c0f" stroke-width="3" />
          <path d="M32 20v24" stroke="#4d7c0f" stroke-width="2.5" />
          {dot(18, 25, 3.2, '#4d7c0f')}
          {dot(22, 32, 3.2, '#4d7c0f')}
          {dot(26, 39, 3.2, '#4d7c0f')}
          {dot(38, 25, 3.2, '#4d7c0f')}
          {dot(42, 32, 3.2, '#4d7c0f')}
          {dot(46, 39, 3.2, '#4d7c0f')}
        </g>
      );
    case 'tens':
      return (
        <g>
          {[12, 22, 32].map((x) => (
            <g>
              <rect x={x} y="10" width="8" height="44" rx="2" fill="#f59e0b" />
              <path d={`M${x} 18.8h8M${x} 27.6h8M${x} 36.4h8M${x} 45.2h8`} stroke="#b45309" stroke-width="1.2" />
            </g>
          ))}
          <rect x="44" y="46" width="8" height="8" rx="2" fill="#f59e0b" />
          <rect x="44" y="36" width="8" height="8" rx="2" fill="#f59e0b" />
        </g>
      );
    case 'bridgeHundred':
      return (
        <g>
          <path d="M4 46h56v10H4z" fill="#f9a8d4" />
          <path d="M4 30h56" stroke="#be185d" stroke-width="4" stroke-linecap="round" />
          <path d="M8 46v-8a12 10 0 0124 0v8M32 46v-8a12 10 0 0124 0v8" fill="none" stroke="#be185d" stroke-width="3.5" />
          <path d="M14 30v-5M24 30v-7M40 30v-7M50 30v-5" stroke="#be185d" stroke-width="3" stroke-linecap="round" />
        </g>
      );
    case 'tables':
      return (
        <g>
          {[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => dot(17 + c * 10, 20 + r * 12, 3.6, '#4338ca')))}
          <path d="M10 14h44M10 50h44" stroke="#a5b4fc" stroke-width="2" stroke-linecap="round" />
        </g>
      );
    case 'bigNumbers':
      return (
        <g>
          <rect x="8" y="22" width="30" height="30" rx="3" fill="#14b8a6" />
          <path d="M14 22v30M20 22v30M26 22v30M32 22v30M8 28h30M8 34h30M8 40h30M8 46h30" stroke="#0f766e" stroke-width="1" />
          <rect x="42" y="12" width="7" height="40" rx="2" fill="#5eead4" />
          <rect x="51" y="44" width="7" height="8" rx="2" fill="#5eead4" />
        </g>
      );
    case 'numberLine':
      return (
        <g>
          <path d="M6 44h52" stroke="#0369a1" stroke-width="3" stroke-linecap="round" />
          {[10, 20, 30, 40, 50].map((x) => (
            <path d={`M${x} 39v10`} stroke="#0369a1" stroke-width="2.5" stroke-linecap="round" />
          ))}
          <path d="M20 38c3-18 17-18 20 0" fill="none" stroke="#f59e0b" stroke-width="3" stroke-dasharray="4 3" stroke-linecap="round" />
          {dot(40, 38, 4, '#16a34a')}
        </g>
      );
    case 'belowZero':
      return (
        <g>
          <path d="M4 34h56v26H4z" fill="#93c5fd" />
          <path d="M4 34c6-4 10 4 16 0s10-4 16 0 10 4 16 0 6-4 8 0" fill="none" stroke="#1d4ed8" stroke-width="2" />
          <path d="M32 8v48" stroke="#1e3a8a" stroke-width="3" stroke-linecap="round" />
          {[14, 22, 42, 50].map((y) => (
            <path d={`M27 ${y}h10`} stroke="#1e3a8a" stroke-width="2" stroke-linecap="round" />
          ))}
          <path d="M24 34h16" stroke="#1e3a8a" stroke-width="3.5" stroke-linecap="round" />
          {dot(32, 46, 4.5, '#f59e0b')}
        </g>
      );
    default:
      return (
        <g>
          {dot(18, 20, 5, '#f43f5e')}
          <path d="M40 12v14M33 19h14" stroke="#16a34a" stroke-width="4" stroke-linecap="round" />
          <rect x="12" y="36" width="14" height="14" rx="3" fill="#3b82f6" />
          <path d="M44 34l3.6 7.3 8 1.2-5.8 5.6 1.4 8-7.2-3.8-7.2 3.8 1.4-8-5.8-5.6 8-1.2z" fill="#f59e0b" />
        </g>
      );
  }
}

export function ThemePicture({ id, size = 56 }: { id: string; size?: number }): JSX.Element {
  return (
    <svg class="theme-pic" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill={TILE[id] ?? TILE.mixed} />
      <Art id={id} />
    </svg>
  );
}
