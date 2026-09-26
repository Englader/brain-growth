/** Shared primitive types. Everything here is serialisable JSON. */

export type BandId = 'A' | 'B' | 'C';
export const BAND_IDS: readonly BandId[] = ['A', 'B', 'C'];

/** Locale ids are open-ended (registry-driven); 'en' is the source-of-truth bundle. */
export type LocaleId = string;

export type SkillId = string;
export type ModeId = string;

export type Strand =
  | 'number'
  | 'placevalue'
  | 'addsub'
  | 'muldiv'
  | 'fractions'
  | 'decimals'
  | 'ratio'
  | 'integers'
  | 'algebra'
  | 'geometry'
  | 'measurement'
  | 'data'
  | 'patterns';
