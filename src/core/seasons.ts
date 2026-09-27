/**
 * Seasonal calendar (plan step 10; DESIGN E-3): Нова година and Велигден.
 *
 *   newYear  Dec 20 – Jan 10 (crosses the year boundary)
 *   easter   Orthodox Easter ± 7 days
 *
 * Rules the integration must keep (E-3: "never exclusive gates"):
 *  - Seasonal cosmetics join the drop pool ONLY in season (`inSeasonDrop`).
 *  - Once earned they never disappear: nothing here filters what a child
 *    owns or can equip.
 *  - They come back every year, so missing a season is never final.
 *  - Nothing gameplay-related depends on a season; it is decoration and
 *    cosmetics only. No countdowns: the public API says which seasons are
 *    active, never how long is left.
 *
 * Dates are local calendar days ("YYYY-MM-DD"), like streaks and quests.
 */
import type { CosmeticDef } from './rewards/cosmetics';
import { dayKey } from './time';
import type { BandId } from './types';

export type SeasonId = 'newYear' | 'easter';

/** Fixed order: activeSeasons() lists seasons in this order. */
export const SEASON_IDS: readonly SeasonId[] = ['newYear', 'easter'];

export const EASTER_WINDOW_DAYS = 7;
const NEW_YEAR_START = { month: 12, day: 20 };
const NEW_YEAR_END = { month: 1, day: 10 };

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

function ymd(y: number, m: number, d: number): string {
  // Normalise through UTC so day overflow (e.g. April 35) rolls into the next month.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function shift(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return ymd(y, m, d + days);
}

/**
 * Orthodox Easter Sunday as a Gregorian "YYYY-MM-DD": Meeus's Julian
 * algorithm, then the Julian→Gregorian offset (13 days for 1900–2099).
 */
export function orthodoxEaster(year: number): string {
  if (!Number.isInteger(year) || year < 1583) throw new RangeError(`orthodoxEaster(${year})`);
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const offset = Math.floor(year / 100) - Math.floor(year / 400) - 2; // 13 in 1900–2099
  return ymd(year, month, day + offset);
}

export interface SeasonWindow {
  id: SeasonId;
  /** The year this occurrence belongs to (New Year: the year that begins). */
  year: number;
  /** First and last day, inclusive. For tests and decoration; never render a countdown from it. */
  start: string;
  end: string;
}

/** The occurrence of a season that belongs to `year`. */
export function seasonWindow(id: SeasonId, year: number): SeasonWindow {
  if (id === 'newYear') {
    return {
      id,
      year,
      start: ymd(year - 1, NEW_YEAR_START.month, NEW_YEAR_START.day),
      end: ymd(year, NEW_YEAR_END.month, NEW_YEAR_END.day),
    };
  }
  const easter = orthodoxEaster(year);
  return { id, year, start: shift(easter, -EASTER_WINDOW_DAYS), end: shift(easter, EASTER_WINDOW_DAYS) };
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A day key from a timestamp (local calendar day) or a "YYYY-MM-DD" string. */
export function toDay(date: number | string): string {
  if (typeof date === 'number') return dayKey(date);
  const m = DAY_RE.exec(date);
  if (!m || ymd(Number(m[1]), Number(m[2]), Number(m[3])) !== date) throw new RangeError(`not a day key: ${date}`);
  return date;
}

/** The occurrence of `id` that contains `date`, or null when out of season. */
export function seasonOccurrence(id: SeasonId, date: number | string): SeasonWindow | null {
  const day = toDay(date);
  const year = Number(day.slice(0, 4));
  // An occurrence of either season touches at most this year and the next.
  for (const y of [year, year + 1]) {
    const w = seasonWindow(id, y);
    if (w.start <= day && day <= w.end) return w;
  }
  return null;
}

/** Seasons active on `date`, in SEASON_IDS order. */
export function activeSeasons(date: number | string): SeasonId[] {
  const day = toDay(date);
  return SEASON_IDS.filter((id) => seasonOccurrence(id, day) !== null);
}

/** The season for decoration (`data-season`), or null. */
export function seasonFor(date: number | string): SeasonId | null {
  return activeSeasons(date)[0] ?? null;
}

/**
 * A stable key for one occurrence ("newYear-2027", "easter-2026"), e.g. for
 * "played during …" metrics. Null out of season.
 */
export function seasonKey(id: SeasonId, date: number | string): string | null {
  const w = seasonOccurrence(id, date);
  return w ? `${id}-${w.year}` : null;
}

/** The ISO week's Thursday (it decides which year the week belongs to). */
export function weekThursday(week: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) throw new RangeError(`not a week key: ${week}`);
  const y = Number(m[1]);
  const w = Number(m[2]);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  return ymd(y, 1, 4 - dow + 1 + 3 + 7 * (w - 1));
}

/**
 * The season that owns a whole ISO week (judged on its Thursday), so a
 * seasonal weekly theme is the same all week and for every sibling.
 */
export function seasonForWeek(week: string): SeasonId | null {
  return seasonFor(weekThursday(week));
}

// ── Seasonal cosmetics (data only; the integration registers them) ─────────

export type SeasonCosmeticDef = CosmeticDef & { source: 'season'; season: SeasonId };

const AB: readonly BandId[] = ['A', 'B'];
const C: readonly BandId[] = ['C'];

/*
 * Seasonal lily pads are CSS backgrounds like the weekly pad sets: the
 * pattern stays near the rim and the centre stays light, so the dark pad
 * number keeps its contrast (a plain red egg pad would not).
 */
const SNOWY_PAD =
  'radial-gradient(circle at 26% 28%, #fff 0 7%, transparent 8%), radial-gradient(circle at 72% 20%, #fff 0 5%, transparent 6%), radial-gradient(circle at 82% 66%, #fff 0 7%, transparent 8%), radial-gradient(circle at 24% 76%, #fff 0 5%, transparent 6%), radial-gradient(circle at 54% 88%, #fff 0 4%, transparent 5%), #bae6fd';
const PAINTED_EGG_PAD =
  'radial-gradient(ellipse 11% 15% at 22% 30%, #ef4444 0 95%, transparent), radial-gradient(ellipse 11% 15% at 78% 30%, #60a5fa 0 95%, transparent), radial-gradient(ellipse 11% 15% at 24% 74%, #c084fc 0 95%, transparent), radial-gradient(ellipse 11% 15% at 76% 74%, #f472b6 0 95%, transparent), #fef9c3';

export const SEASON_COSMETICS: readonly SeasonCosmeticDef[] = [
  // Нова година: winter hat and snowy pad for A/B; frost accent and a title for C.
  { id: 'season.newYear.hat', slot: 'hat', bands: AB, rarity: 2, value: 'winterHat', source: 'season', season: 'newYear' },
  { id: 'season.newYear.pad', slot: 'pad', bands: AB, rarity: 1, value: SNOWY_PAD, source: 'season', season: 'newYear' },
  { id: 'season.newYear.color', slot: 'color', bands: AB, rarity: 3, value: '#b91c1c', source: 'season', season: 'newYear' },
  { id: 'season.newYear.theme', slot: 'theme', bands: C, rarity: 1, value: '#7dd3fc', source: 'season', season: 'newYear' },
  { id: 'season.newYear.title', slot: 'title', bands: C, rarity: 2, value: '', source: 'season', season: 'newYear' },
  // Велигден: painted-egg pad, flower crown; spring accent and a title for C.
  { id: 'season.easter.hat', slot: 'hat', bands: AB, rarity: 2, value: 'flowerCrown', source: 'season', season: 'easter' },
  { id: 'season.easter.pad', slot: 'pad', bands: AB, rarity: 1, value: PAINTED_EGG_PAD, source: 'season', season: 'easter' },
  { id: 'season.easter.color', slot: 'color', bands: AB, rarity: 3, value: '#facc15', source: 'season', season: 'easter' },
  { id: 'season.easter.theme', slot: 'theme', bands: C, rarity: 1, value: '#86efac', source: 'season', season: 'easter' },
  { id: 'season.easter.title', slot: 'title', bands: C, rarity: 2, value: '', source: 'season', season: 'easter' },
];

export function getSeasonCosmetic(id: string): SeasonCosmeticDef | undefined {
  return SEASON_COSMETICS.find((c) => c.id === id);
}

/** Any cosmetic-like record; `season` is read loosely so a widened CosmeticDef still fits. */
type MaybeSeasonal = Pick<CosmeticDef, 'id'> & { source?: string; season?: string };

/**
 * Drop-pool filter: a seasonal cosmetic may DROP only while its season is
 * active; everything else is unaffected. Never use this to filter owned or
 * equippable cosmetics.
 */
export function inSeasonDrop(def: MaybeSeasonal, date: number | string): boolean {
  if (def.source !== 'season') return true;
  const season = def.season ?? getSeasonCosmetic(def.id)?.season;
  return season !== undefined && (activeSeasons(date) as string[]).includes(season);
}

/** The unowned seasonal cosmetics a band can get as a drop on `date` (empty off-season). */
export function seasonalDropPool(date: number | string, band: BandId, owned: readonly string[]): SeasonCosmeticDef[] {
  const active = activeSeasons(date);
  return SEASON_COSMETICS.filter((c) => active.includes(c.season) && c.bands.includes(band) && !owned.includes(c.id));
}

/**
 * Wardrobe: an owned cosmetic always shows (seasonal ones never disappear).
 * An unowned seasonal one shows as a "?" only while it can drop, so nothing
 * teases an item that is out of reach until next year. `date` null means
 * seasonal touches are switched off for the child.
 */
export function shownInWardrobe(def: MaybeSeasonal, owned: boolean, date: number | string | null): boolean {
  if (owned || def.source !== 'season') return true;
  return date !== null && inSeasonDrop(def, date);
}

/** Profile flag (default on) that switches every seasonal touch for a child: decoration, drops, weekly theme, greetings. */
export const SEASON_FLAG = 'season';

/**
 * Message keys (strings only in the `season` block, `cos.season.*`,
 * `ach.season.*` and `voice.season.*`). None takes a time, date or days
 * parameter: the calendar is never shown as something running out.
 */
export const seasonNameKey = (id: SeasonId): string => `season.${id}.name`;
/** The seasonal weekly theme's name and description. */
export const seasonWeekKey = (id: SeasonId): string => `season.${id}.week`;
export const seasonWeekDescKey = (id: SeasonId): string => `season.${id}.weekDesc`;
/** Band A home greeting in season (spoken instead of voice.welcome). */
export const seasonGreetingKey = (id: SeasonId): string => `voice.season.${id}`;
