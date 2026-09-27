/**
 * Inline SVG icon set (stroke-based, 24×24). Icons carry meaning for
 * pre-readers, so every interactive icon also gets an aria-label from the
 * locale bundle at the call site.
 */
import type { JSX } from 'preact';

const PATHS = {
  play: 'M8 5v14l11-7z',
  back: 'M15 18l-6-6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  speaker: 'M4 10v4h4l5 4V6L8 10H4zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  trophy: 'M8 4h8v5a4 4 0 01-8 0zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8M10 17h4',
  hanger: 'M12 7a2 2 0 112-2M12 7v2L3 16h18l-9-7',
  people: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 11a2.5 2.5 0 100-5M16 14a5 5 0 015 6',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0',
  flame: 'M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-3 2-4 2-6 1 1 2 2 3 1-1-2 0-4 0-5z',
  snow: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 4l3 2 3-2M9 20l3-2 3 2',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v6h14v-6',
  download: 'M12 4v11M8 11l4 4 4-4M5 20h14',
  upload: 'M12 16V5M8 9l4-4 4 4M5 20h14',
  bolt: 'M13 3L5 13h6l-1 8 8-10h-6z',
  mountain: 'M3 19l6-9 4 5 3-4 5 8z',
  swap: 'M7 7h11l-3-3M17 17H6l3 3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  times: 'M7 7l10 10M17 7L7 17',
  arrowL: 'M19 12H6M11 6l-6 6 6 6',
  arrowR: 'M5 12h13M13 6l6 6-6 6',
  flag: 'M6 21V4M6 4h11l-2 4 2 4H6',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.5-7 10-7 10z',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01',
  compass: 'M12 21a9 9 0 100-18 9 9 0 000 18zM15.5 8.5l-2 5-5 2 2-5z',
  sprout: 'M12 20v-8M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 14c0-4 3-6 7-6 0 4-3 6-7 6z',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  shield: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  boomerang: 'M5 19C5 10 10 5 19 5l-3 5c-4 0-6 2-6 6z',
  wrench: 'M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z',
  dice: 'M5 5h14v14H5zM9 9h.01M15 15h.01M15 9h.01M9 15h.01M12 12h.01',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  speech: 'M4 5h16v11H9l-5 4z',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  bird: 'M4 14c4 0 6-3 8-7 1 3 3 5 8 5-3 3-7 5-11 5-2 0-4-1-5-3z',
  kite: 'M12 3l6 7-6 8-6-8zM12 18l-2 3',
  mirror: 'M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5',
  ring: 'M12 19a7 7 0 100-14 7 7 0 000 14z',
  bridge: 'M3 16h18M5 16v-4M19 16v-4M3 12c4-6 14-6 18 0M9 16v-5M15 16v-5',
  door: 'M6 21V4h10v17M4 21h16M13 12h.01',
  hint: 'M9 18h6M10 21h4M12 3a6 6 0 00-3 11v2h6v-2a6 6 0 00-3-11z',
  hops: 'M4 18c2-6 6-6 8 0M12 18c2-6 6-6 8 0',
  backspace: 'M21 5H8l-6 7 6 7h13zM12 9l6 6M18 9l-6 6',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  question: 'M9 9a3 3 0 115 2c-1 .8-2 1.4-2 3M12 18h.01',
  // Today's challenges (DESIGN A-29): a disc cut in half for the fraction/decimal practice.
  fraction: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 3v18M12 8h4.5M12 12h6M12 16h4.5',
  // Feature icons (24×24 stroke paths), each under its own anchor:
  // ── slot: frac ──
  // ── slot: hint ──
  // ── slot: pilot ──
  // ── slot: storage ──
  // ── slot: weekly ──
  // ── slot: target ──
  cards: 'M3 8h11v13H3zM8 5V3h11v13h-5',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  restart: 'M3 12a9 9 0 103-6.7L3 8M3 3v5h5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  // ── slot: dice ──
  // ── slot: puzzle ──
  puzzle: 'M5 8h3.5a2.5 2.5 0 015 0H17v3.5a2.5 2.5 0 010 5V20H5z',
  pattern: 'M3 12a2 2 0 104 0 2 2 0 00-4 0zM10 10h4v4h-4zM17 12a2 2 0 104 0 2 2 0 00-4 0z',
  scale: 'M12 4v16M8 20h8M5 7h14M5 7l-3 6h6zM19 7l-3 6h6z',
  ruler: 'M3 16L16 3l5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2',
  grid: 'M4 4h16v16H4zM4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16',
  key: 'M8 16a4 4 0 110-8 4 4 0 010 8zM12 12h9M18 12v3M21 12v2',
  // ── slot: workshop ──
  shapes: 'M4 4h16v16H4zM4 12h16M12 4v16M4 4h8v8H4z',
  // ── slot: balance ──
  // (Balance uses `scale` from the puzzle slot and `undo` from the target slot.)
  // ── slot: coord ──
  axes: 'M3 12h18M19 10l2 2-2 2M12 21V3M10 5l2-2 2 2M16 7.5a1.5 1.5 0 103 0 1.5 1.5 0 10-3 0',
  arrowU: 'M12 19V6M6 11l6-6 6 6',
  arrowD: 'M12 5v13M6 13l6 6 6-6',
  // ── slot: season ──
  egg: 'M12 3c-3.6 0-6.5 6-6.5 10.5a6.5 6.5 0 0013 0C18.5 9 15.6 3 12 3zM6 13l2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5',
} as const;

export type IconName = keyof typeof PATHS;

/** Achievement icon names map onto the base set. */
const ALIAS: Record<string, IconName> = {
  stars: 'star', constellation: 'star', flame2: 'flame', flame3: 'flame', sunrise: 'sun', boulder: 'mountain',
  summit: 'mountain', bandage: 'heart', toolbox: 'wrench', frog: 'hops',
};

export function iconFor(name: string): IconName {
  return (name in PATHS ? name : ALIAS[name] ?? 'star') as IconName;
}

export function Icon(props: { name: IconName | string; size?: number; label?: string; solid?: boolean } & Omit<JSX.SVGAttributes<SVGSVGElement>, 'fill'>): JSX.Element {
  const { name, size = 24, label, solid, ...rest } = props;
  const d = PATHS[iconFor(name)];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}
