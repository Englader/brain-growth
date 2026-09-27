/**
 * Pip the frog (Bands A/B) and the minimal marker (Band C). Pure SVG, colours
 * and hats come from equipped cosmetics.
 */
import type { JSX } from 'preact';
import { getCosmetic } from '../../core/rewards/cosmetics';

export function Hat({ id }: { id?: string | undefined }): JSX.Element | null {
  const v = id ? getCosmetic(id)?.value : undefined;
  switch (v) {
    case 'cap':
      return (
        <g>
          <path d="M34 26 Q50 8 66 26 Z" fill="#ef4444" />
          <rect x="60" y="23" width="18" height="5" rx="2.5" fill="#b91c1c" />
        </g>
      );
    case 'flower':
      return (
        <g transform="translate(62 20)">
          {[0, 72, 144, 216, 288].map((a) => (
            <circle cx={Math.cos((a * Math.PI) / 180) * 6} cy={Math.sin((a * Math.PI) / 180) * 6} r="5" fill="#f9a8d4" />
          ))}
          <circle r="4" fill="#fde047" />
        </g>
      );
    case 'party':
      return (
        <g>
          <path d="M40 26 L50 0 L60 26 Z" fill="#a855f7" />
          <circle cx="50" cy="0" r="4" fill="#fde047" />
          <path d="M44 18 L56 18 M42 23 L58 23" stroke="#fde047" stroke-width="2" />
        </g>
      );
    case 'wizard':
      return (
        <g>
          <path d="M36 27 L52 -4 L64 27 Z" fill="#1e3a8a" />
          <path d="M30 27 H70" stroke="#1e3a8a" stroke-width="5" stroke-linecap="round" />
          <circle cx="50" cy="12" r="2.5" fill="#fde047" />
          <circle cx="55" cy="20" r="1.8" fill="#fde047" />
        </g>
      );
    case 'crown':
      return (
        <path d="M36 26 L38 10 L45 18 L50 6 L55 18 L62 10 L64 26 Z" fill="#facc15" stroke="#ca8a04" stroke-width="1.5" />
      );
    // Seasonal hats (src/core/seasons.ts): a knitted New Year beanie, a spring flower crown.
    case 'winterHat':
      return (
        <g>
          <path d="M32 20 C32 7 41 1 50 1 C59 1 68 7 68 20 Z" fill="#dc2626" stroke="#991b1b" stroke-width="1.5" stroke-linejoin="round" />
          <path d="M35.5 11.5 Q50 6.5 64.5 11.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" />
          <rect x="29" y="18" width="42" height="8.5" rx="4.25" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.2" />
          <path d="M35 20.5v4M41 20.5v4M47 20.5v4M53 20.5v4M59 20.5v4M65 20.5v4" stroke="#cbd5e1" stroke-width="1.4" stroke-linecap="round" />
          <circle cx="50" cy="-1" r="5.5" fill="#fff" stroke="#cbd5e1" stroke-width="1.2" />
        </g>
      );
    case 'flowerCrown':
      return (
        <g>
          <path d="M26 21 Q50 6 74 21" fill="none" stroke="#15803d" stroke-width="2.5" stroke-linecap="round" />
          {[
            [32, 17.5, -35],
            [44, 13.8, -12],
            [56, 13.8, 12],
            [68, 17.5, 35],
          ].map(([x, y, r]) => (
            <ellipse cx={x} cy={y} rx="3.6" ry="1.9" transform={`rotate(${r} ${x} ${y})`} fill="#22c55e" />
          ))}
          {[
            [26, 21, '#f9a8d4', '#facc15'],
            [38, 15.4, '#fde047', '#f97316'],
            [50, 13.5, '#ffffff', '#facc15'],
            [62, 15.4, '#c4b5fd', '#facc15'],
            [74, 21, '#f9a8d4', '#facc15'],
          ].map(([x, y, petal, heart]) => (
            <g transform={`translate(${x} ${y})`}>
              {[0, 72, 144, 216, 288].map((a) => (
                <circle
                  cx={Math.cos(((a - 90) * Math.PI) / 180) * 3.4}
                  cy={Math.sin(((a - 90) * Math.PI) / 180) * 3.4}
                  r="3"
                  fill={petal as string}
                  stroke="rgba(0,0,0,.15)"
                  stroke-width=".6"
                />
              ))}
              <circle r="2.2" fill={heart as string} />
            </g>
          ))}
        </g>
      );
    default:
      return null;
  }
}

export interface FrogProps {
  color: string;
  hat?: string | undefined;
  size?: number;
  mood?: 'idle' | 'happy' | 'think';
  class?: string;
  onClick?: () => void;
  label?: string;
}

export function Frog({ color, hat, size = 64, mood = 'idle', class: cls, onClick, label }: FrogProps): JSX.Element {
  const mouth = mood === 'happy' ? 'M38 58 Q50 70 62 58' : mood === 'think' ? 'M42 62 Q50 60 58 62' : 'M40 60 Q50 66 60 60';
  return (
    <svg
      class={cls}
      width={size}
      height={size}
      viewBox="0 -8 100 100"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      onClick={onClick}
    >
      <ellipse cx="50" cy="86" rx="30" ry="5" fill="rgba(0,0,0,.12)" />
      <ellipse cx="26" cy="78" rx="14" ry="8" fill={color} />
      <ellipse cx="74" cy="78" rx="14" ry="8" fill={color} />
      <ellipse cx="50" cy="58" rx="34" ry="26" fill={color} />
      <ellipse cx="50" cy="66" rx="22" ry="14" fill="rgba(255,255,255,.35)" />
      <circle cx="34" cy="34" r="13" fill={color} />
      <circle cx="66" cy="34" r="13" fill={color} />
      <circle cx="34" cy="33" r="8.5" fill="#fff" />
      <circle cx="66" cy="33" r="8.5" fill="#fff" />
      <circle cx={mood === 'think' ? 37 : 35} cy="34" r="4.2" fill="#111" />
      <circle cx={mood === 'think' ? 69 : 67} cy="34" r="4.2" fill="#111" />
      <path d={mouth} stroke="#14532d" stroke-width="3" fill="none" stroke-linecap="round" />
      <circle cx="30" cy="54" r="3.5" fill="rgba(244,114,182,.55)" />
      <circle cx="70" cy="54" r="3.5" fill="rgba(244,114,182,.55)" />
      <Hat id={hat} />
    </svg>
  );
}

/** Band C hopper: a clean marker with a ring. */
export function Marker({ size = 28 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="12" fill="none" stroke="var(--accent)" stroke-width="2.5" />
      <circle cx="14" cy="14" r="5" fill="var(--accent)" />
    </svg>
  );
}
