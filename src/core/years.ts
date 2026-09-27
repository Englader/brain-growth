/**
 * School years (DESIGN A-29): the year bar on a child's home maps onto the
 * skill graph's curriculum positions.
 *
 * Convention (catalog.ts, DESIGN §1.3): a skill's `grade` is its position on
 * the North Macedonian nine-year sequence, 0 = preschool, 4.5 = the middle of
 * одделение 4. So school year N holds the skills with grade ∈ [N, N + 1), and
 * year 0 is „Предучилишно" / "Pre-school". Children start одделение 1 in the
 * September they turn 6, so a child's own year is clamp(age − 5, 0, 9).
 *
 * Pure and language-neutral: the UI renders a year with `year.label`.
 */
import type { SkillDef } from './skills/types';
import type { BandId } from './types';

/** Highest school year (одделение 9). */
export const MAX_YEAR = 9;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** The school year a curriculum position falls in: grade ∈ [N, N + 1) → N. */
export function yearOfGrade(grade: number): number {
  // A tiny epsilon keeps 5.0 in year 5 whatever float noise a grade carries.
  return clamp(Math.floor(grade + 1e-9), 0, MAX_YEAR);
}

/** Whether a skill belongs to school year `year`. */
export function inYear(skill: Pick<SkillDef, 'grade'>, year: number): boolean {
  return yearOfGrade(skill.grade) === year;
}

/** The child's own school year from age: MK children start одделение 1 at 6. */
export function ownYear(age: number): number {
  return clamp(Math.round(age) - 5, 0, MAX_YEAR);
}

/**
 * The band whose content a year belongs to (the grade windows of BAND_GRADES:
 * A [0, 3), B [3, 7), C [7, 10)). Used for puzzle types; a child's UI band
 * never changes with the year browsed.
 */
export function yearBand(year: number): BandId {
  return year <= 2 ? 'A' : year <= 6 ? 'B' : 'C';
}

/** `wanted` if it is one of `years`, else the nearest one (ties go to the lower year); null when there are none. */
export function nearestYear(wanted: number, years: readonly number[]): number | null {
  let best: number | null = null;
  for (const y of years) {
    if (best === null || Math.abs(y - wanted) < Math.abs(best - wanted) || (Math.abs(y - wanted) === Math.abs(best - wanted) && y < best)) best = y;
  }
  return best;
}

/**
 * Puzzles follow the year browsed (DESIGN A-29, §1.4): types come from the
 * year's band, kept to the ones the child's own band can play (reading, and
 * the Band A picture presentation), and the requested level moves by
 * PUZZLE_YEAR_SHIFT per year above or below the child's own year (at most
 * PUZZLE_YEAR_SPAN years each way). The shift is a level offset, so the
 * chip's target (0.75, or 0.55 for "Harder one") and the achievement that
 * reads it are unchanged; the event's `req` still rebuilds the exact puzzle.
 */
export const PUZZLE_YEAR_SHIFT = 0.08;
export const PUZZLE_YEAR_SPAN = 3;

export function puzzleLevelShift(year: number, own: number): number {
  return PUZZLE_YEAR_SHIFT * clamp(year - own, -PUZZLE_YEAR_SPAN, PUZZLE_YEAR_SPAN);
}

/**
 * Puzzle type ids per band, in shelf order: the same as the puzzle track's
 * registrations (src/puzzles, checked by tests/years.test.ts). Kept here so
 * the home screen can build today's challenges without loading the track.
 */
export const PUZZLE_TYPE_IDS: Readonly<Record<BandId, readonly string[]>> = {
  A: ['pattern', 'balance'],
  B: ['pattern', 'balance', 'estimate', 'logic'],
  C: ['pattern', 'balance', 'estimate', 'logic', 'crypt'],
};

export const puzzleTypeIdsFor = (band: BandId): Array<{ id: string }> => PUZZLE_TYPE_IDS[band].map((id) => ({ id }));

/** Puzzle type ids for a year: the year band's types the child's band can also play (registration order kept). */
export function puzzleTypesForYear(year: number, childBand: BandId, typesFor: (band: BandId) => readonly { id: string }[]): string[] {
  const mine = new Set(typesFor(childBand).map((d) => d.id));
  const ofYear = typesFor(yearBand(year))
    .map((d) => d.id)
    .filter((id) => mine.has(id));
  // Every band shares patterns and balances, so this is never empty; fall back to the child's own types anyway.
  return ofYear.length ? ofYear : [...mine];
}
