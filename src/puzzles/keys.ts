/**
 * Every message key the puzzle core hands to the UI. The strings themselves
 * live in the locale bundles (`puzzle` block, en and mk); this list lets a test
 * pin that the core never emits a key that is not listed here.
 */

/** Shelf title per type: `puzzle.type.<id>`. */
export const PUZZLE_TYPE_KEYS = {
  pattern: 'puzzle.type.pattern',
  balance: 'puzzle.type.balance',
  estimate: 'puzzle.type.estimate',
  logic: 'puzzle.type.logic',
  crypt: 'puzzle.type.crypt',
} as const;

/**
 * Gentle "not yet" feedback per violated-constraint kind. A violation id is
 * `kind` or `kind:detail`; its message key is `puzzle.violated.<kind>`, with
 * the detail (scale index, column index, shape or symbol id) used for the
 * highlight rather than the text. Estimates never show a direction: `below`
 * and `above` both read "not inside your range yet", otherwise children home
 * in by trial instead of estimating (the event log keeps the precise id).
 */
export const PUZZLE_VIOLATION_KEYS = {
  answer: 'puzzle.violated.answer',
  next: 'puzzle.violated.next',
  scale: 'puzzle.violated.scale',
  shape: 'puzzle.violated.shape',
  wide: 'puzzle.violated.wide',
  below: 'puzzle.violated.outside',
  above: 'puzzle.violated.outside',
  missing: 'puzzle.violated.missing',
  distinct: 'puzzle.violated.distinct',
  lead: 'puzzle.violated.lead',
  col: 'puzzle.violated.col',
  twice: 'puzzle.violated.twice',
  clue: 'puzzle.violated.clue',
} as const;

/** Hint rungs, with the params each one carries. */
export const PUZZLE_HINT_KEYS = [
  // pattern (tiles)
  'puzzle.hint.pattern.unit', // {} focus: the repeating unit
  'puzzle.hint.pattern.same', // {} focus: the tile the next one copies
  'puzzle.hint.pattern.groups', // {} focus: the groups of a growing pattern
  'puzzle.hint.pattern.grows', // {} focus: the last two groups
  // pattern (numbers)
  'puzzle.hint.pattern.gaps', // {} show the differences
  'puzzle.hint.pattern.ratios', // {} show the ratios
  'puzzle.hint.pattern.neighbours', // {} look at three in a row
  'puzzle.hint.pattern.step', // {step}
  'puzzle.hint.pattern.ratio', // {num, den}: times num/den (den 1 = whole times; num 1, den 2 = halve)
  'puzzle.hint.pattern.alternate', // {first, second}: steps take turns
  'puzzle.hint.pattern.gapGrows', // {by}: each gap grows by
  'puzzle.hint.pattern.sumTwo', // {}: add the two before
  'puzzle.hint.pattern.nextGap', // {gap}: the next gap is
  // balance
  'puzzle.hint.balance.start', // {} focus: the scale to start with
  'puzzle.hint.balance.compare', // {} focus: two scales to compare
  'puzzle.hint.balance.remove', // {units}: take the same off both pans
  'puzzle.hint.balance.share', // {count, units}: share the units equally
  'puzzle.hint.balance.count', // {}: count the cubes
  'puzzle.hint.balance.known', // {shape, weight}
  // estimate
  'puzzle.hint.estimate.roundEach', // {to}: round each number to the nearest `to`
  'puzzle.hint.estimate.roundBoth', // {a, b}: think a · b
  'puzzle.hint.estimate.friendlyDivide', // {a, b}: think a : b
  'puzzle.hint.estimate.tenPercent', // {tenth}: 10 % is about `tenth`
  'puzzle.hint.estimate.about', // {value}: it is about
  'puzzle.hint.estimate.between', // {lo, hi}: it is between
  // logic
  'puzzle.hint.logic.start', // {} focus: the clue to start with
  'puzzle.hint.logic.pair', // {item, anchor}: these two go together
  // crypt
  'puzzle.hint.crypt.carry', // {sym}: the extra symbol on the left is 1
  'puzzle.hint.crypt.units', // {} focus: start with the units column
  'puzzle.hint.crypt.reveal', // {sym, digit}
] as const;

export type PuzzleHintKey = (typeof PUZZLE_HINT_KEYS)[number];

/** Message key for a violation id such as `scale:1` or `wide`. */
export function violationKey(id: string): string {
  const kind = id.split(':')[0] ?? id;
  return (PUZZLE_VIOLATION_KEYS as Record<string, string>)[kind] ?? PUZZLE_VIOLATION_KEYS.answer;
}
