/** One view per puzzle type (ids from src/puzzles/index.ts). */
import { balanceView } from './BalanceView';
import { cryptView } from './CryptView';
import { estimateView } from './EstimateView';
import { logicView } from './LogicView';
import { patternView } from './PatternView';
import type { ViewDef } from './types';

// eslint-free heterogeneous map: each view is typed against its own puzzle type.
export const VIEWS: Record<string, ViewDef<any, any, any>> = {
  pattern: patternView,
  balance: balanceView,
  estimate: estimateView,
  logic: logicView,
  crypt: cryptView,
};
