/**
 * Feature flags. Anything experimental ships dark and is switched on per
 * profile (adult dashboard) or per device. Precedence:
 *   URL (?ff=a,-b, dev/testing only) > profile override > device override > default
 */
export type FlagScope = 'profile' | 'device';

export interface FlagDef {
  id: string;
  scope: FlagScope;
  default: boolean;
  /** Plain-English description for the adult dashboard (not child-facing; not localised). */
  description: string;
}

export const FLAGS: readonly FlagDef[] = [
  { id: 'mode.sprint', scope: 'profile', default: false, description: 'Timed "race your shadow" sprint on mastered fluency skills (opt-in, Bands B/C only).' },
  { id: 'quests.daily', scope: 'profile', default: true, description: 'Daily quest card with 2–3 varied objectives.' },
  { id: 'hints', scope: 'profile', default: true, description: 'Hint button (Bands B/C). Hinted answers count as half evidence.' },
  { id: 'league.family', scope: 'device', default: true, description: 'Family board and rival-card sharing.' },
  { id: 'audio.tts', scope: 'device', default: true, description: 'Fall back to the browser speech engine when no recorded clip exists.' },
  { id: 'debug.shortSessions', scope: 'device', default: false, description: 'Four-item sessions (testing).' },
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
