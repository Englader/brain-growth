/**
 * Puzzle track: registers the built-in puzzle types (shelf order) and
 * re-exports the public API. Import this module once at start-up.
 */
import { hasPuzzleType, registerPuzzleType } from './registry';
import { balancePuzzle } from './types/balance';
import { cryptPuzzle } from './types/crypt';
import { estimatePuzzle } from './types/estimate';
import { logicPuzzle } from './types/logic';
import { patternPuzzle } from './types/pattern';
import type { AnyPuzzleType } from './types';

const BUILTIN: AnyPuzzleType[] = [patternPuzzle, balancePuzzle, estimatePuzzle, logicPuzzle, cryptPuzzle];

for (const t of BUILTIN) if (!hasPuzzleType(t.id)) registerPuzzleType(t);

export { allPuzzleTypes, getPuzzleType, hasPuzzleType, puzzleTypesFor, registerPuzzleType } from './registry';
export type { AnyPuzzleType, CheckResult, GeneratedPuzzle, PuzzleHint, PuzzleTypeDef, PuzzleTypeId } from './types';
export {
  applyPuzzleResult,
  initPuzzleRating,
  predictPuzzle,
  puzzleY,
  PUZZLE_SCORE,
  updatePuzzleRating,
  type PuzzleObservation,
  type PuzzleOutcome,
  type PuzzleRating,
  type PuzzleRatings,
} from './rating';
export { levelJitter, PUZZLE_TARGET, puzzleLevelFor, rebuildPuzzle, startPuzzle, type StartedPuzzle } from './select';
export {
  finishPuzzle,
  parsePuzzleEvent,
  PUZZLE_EVENT,
  puzzleEventsFromLog,
  replayPuzzleRatings,
  type PuzzleEvent,
} from './replay';
export type { BalanceAnswer, BalancePuzzle, Pan, PanItem, Scale } from './types/balance';
export type { CryptAnswer, CryptPuzzle } from './types/crypt';
export type { EstimateAnswer, EstimatePuzzle, Quantity, Ruler } from './types/estimate';
export type { LogicAnswer, LogicClue, LogicPuzzle } from './types/logic';
export type { NumberPattern, PatternAnswer, PatternPuzzle, TilePattern } from './types/pattern';
export { PUZZLE_HINT_KEYS, PUZZLE_TYPE_KEYS, PUZZLE_VIOLATION_KEYS, violationKey, type PuzzleHintKey } from './keys';
export { estimateTruth } from './types/estimate';
export { SHAPE_IDS } from './types/balance';
export { SYMBOL_IDS } from './types/crypt';
export { TILE_IDS } from './types/pattern';
