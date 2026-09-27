/**
 * Feature flags. Features ship ON once their e2e flow passes (DESIGN A-26);
 * the flag stays as a per-child (profile) or per-device switch in the adult
 * dashboard. Precedence:
 *   URL (?ff=a,-b, dev/testing only) > profile override > device override > default
 */
export type FlagScope = 'profile' | 'device';

export interface FlagDef {
  id: string;
  scope: FlagScope;
  default: boolean;
  /** Plain-English description for developers (not shown; the adult dashboard shows the localised label). */
  description: string;
  /** Message key of the adult-dashboard label; default `flag.<id>`. Features use `<feature>.flag` (their own block). */
  labelKey?: string;
}

/** The message key that labels a flag in the adult dashboard. */
export function flagLabelKey(def: FlagDef): string {
  return def.labelKey ?? `flag.${def.id}`;
}

export const FLAGS: readonly FlagDef[] = [
  { id: 'mode.sprint', scope: 'profile', default: true, description: 'Timed "race your shadow" sprint on Solid fluency skills (a card the child may choose; Bands B/C only).' },
  { id: 'quests.daily', scope: 'profile', default: true, description: 'Daily quest card with 2–3 varied objectives.' },
  { id: 'hints', scope: 'profile', default: true, description: 'Hint ladder (Bands B/C, not Sprint): strategy, first hop, worked step. A correct answer after tier t counts as 1 − 0.25·t evidence.' },
  { id: 'league.family', scope: 'device', default: true, description: 'Family board and rival-card sharing.' },
  { id: 'audio.tts', scope: 'device', default: true, description: 'Fall back to the browser speech engine when no recorded clip exists.' },
  { id: 'debug.shortSessions', scope: 'device', default: false, description: 'Four-item sessions (testing).' },
  // Feature flags (ship ON per DESIGN A-26; label via labelKey: '<feature>.flag'), each under its own anchor:
  // ── slot: frac ──
  // ── slot: hint ──
  // ── slot: pilot ──
  // ── slot: storage ──
  // ── slot: weekly ──
  { id: 'weekly', scope: 'profile', default: true, labelKey: 'weekly.flag', description: 'Weekly themed challenge: a 5-session set with a cosmetic set piece; themed sessions boost theme skills.' },
  // ── slot: target ──
  { id: 'mode.target', scope: 'profile', default: true, description: 'Make it: combine dealt cards with the operations to hit a target number (all bands; evidence weight 0.5).', labelKey: 'target.flag' },
  // ── slot: dice ──
  { id: 'mode.dice', scope: 'profile', default: true, labelKey: 'dice.flag', description: 'Dice Race: two children on this device race on their own lanes, each move one of their own adaptive items (pass-and-play).' },
  // ── slot: puzzle ──
  { id: 'mode.puzzle', scope: 'profile', default: true, labelKey: 'puzzle.flag', description: 'Puzzle track: patterns, balance scales, estimation ranges, logic grids and cryptarithms; untimed, own rating per type, never needed for progress.' },
  // ── slot: workshop ──
  // ── slot: balance ──
  { id: 'mode.balance', scope: 'profile', default: true, labelKey: 'balance.flag', description: 'Balance: solve equations on a pan scale, doing the same to both pans (Bands B/C, once an equation skill unlocks).' },
  // ── slot: coord ──
  { id: 'mode.coord', scope: 'profile', default: true, labelKey: 'coord.flag', description: 'Coordinate plane: plot and read lattice points in −6…6 (Band C, and Band B once geo.coord unlocks).' },
  // ── slot: season ──
  { id: 'season', scope: 'profile', default: true, labelKey: 'season.flag', description: 'Seasonal touches (New Year, Orthodox Easter): decoration, seasonal cosmetics in the drop pool, the seasonal weekly theme, a seasonal greeting.' },
];

const byId = new Map(FLAGS.map((f) => [f.id, f]));

export function registerFlag(def: FlagDef): void {
  if (byId.has(def.id)) throw new Error(`flag ${def.id} registered twice`);
  (FLAGS as FlagDef[]).push(def);
  byId.set(def.id, def);
}

let urlOverrides: Record<string, boolean> = {};

/** Parse `?ff=mode.sprint,-quests.daily` once at boot. */
export function setUrlOverrides(search: string): void {
  const ff = new URLSearchParams(search).get('ff');
  urlOverrides = {};
  if (!ff) return;
  for (const part of ff.split(',')) {
    const on = !part.startsWith('-');
    const id = part.replace(/^[-+]/, '').trim();
    if (byId.has(id)) urlOverrides[id] = on;
  }
}

export function isEnabled(
  id: string,
  profileFlags: Record<string, boolean> | undefined,
  deviceFlags: Record<string, boolean> | undefined,
): boolean {
  const def = byId.get(id);
  if (!def) return false;
  if (id in urlOverrides) return urlOverrides[id]!;
  if (def.scope === 'profile' && profileFlags && id in profileFlags) return profileFlags[id]!;
  if (deviceFlags && id in deviceFlags) return deviceFlags[id]!;
  return def.default;
}
