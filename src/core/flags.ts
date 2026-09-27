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
  { id: 'hints', scope: 'profile', default: true, description: 'Hint button (Bands B/C). Hinted answers count as half evidence.' },
  { id: 'league.family', scope: 'device', default: true, description: 'Family board and rival-card sharing.' },
  { id: 'audio.tts', scope: 'device', default: true, description: 'Fall back to the browser speech engine when no recorded clip exists.' },
  { id: 'debug.shortSessions', scope: 'device', default: false, description: 'Four-item sessions (testing).' },
  // Feature flags (ship ON per DESIGN A-26; label via labelKey: '<feature>.flag'), each under its own anchor:
  // ── slot: frac ──
  // ── slot: hint ──
  // ── slot: pilot ──
  // ── slot: storage ──
  // ── slot: weekly ──
  // ── slot: target ──
  // ── slot: dice ──
  // ── slot: puzzle ──
  // ── slot: workshop ──
  // ── slot: balance ──
  { id: 'mode.balance', scope: 'profile', default: true, labelKey: 'balance.flag', description: 'Balance: solve equations on a pan scale, doing the same to both pans (Bands B/C, once an equation skill unlocks).' },
  // ── slot: coord ──
  { id: 'mode.coord', scope: 'profile', default: true, labelKey: 'coord.flag', description: 'Coordinate plane: plot and read lattice points in −6…6 (Band C, and Band B once geo.coord unlocks).' },
  // ── slot: season ──
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
