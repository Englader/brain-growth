import './metrics';
// Feature metrics: one side-effect import (`import './metrics/<feature>';`) under its own anchor.
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
import './metrics/balance';
// ── slot: coord ──
import './metrics/coord';
// ── slot: season ──

export { ACHIEVEMENTS } from './definitions';
export { evaluateAchievements, validateAchievements, evalCondition, appliesToBand } from './evaluator';
export { registerMetric, getMetric, allMetrics } from './metrics';
export type { AchievementDef, AchievementCategory, Condition, EvalContext, MetricDef, MetricKind, Trigger } from './types';
