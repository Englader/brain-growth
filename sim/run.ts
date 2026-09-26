/**
 * Simulation report (npm run sim): placement accuracy, realised success rate,
 * tracking error and curriculum progress over simulated weeks.
 */
import { createRng } from '../src/core/rng';
import { GRAPH } from '../src/core/skills';
import { DAY_MS } from '../src/core/time';
import { newSnapshot, runSession, SimClock } from './harness';
import { randomLearner } from './learner';

const N = Number(process.env.SIM_N ?? 300);
const rng = createRng(12345);

// ── 1. Placement accuracy within the playable range ─────────────────────────
const errs: number[] = [];
const wrongs: number[] = [];
const itemsUsed: number[] = [];
for (let i = 0; i < N; i++) {
  const learner = randomLearner(rng, GRAPH, [0.3, 4.2]);
  const age = Math.round(learner.params.g + 5 + rng.normal() * 0.8);
  const clock = new SimClock();
  const r = runSession(learner, newSnapshot(age), clock, rng, { items: 10, targetP: 0.85, seed: i + 1 });
  if (!r.placementDone) continue;
  errs.push(Math.abs(r.placementDone.g - learner.params.g));
  wrongs.push(r.placementWrong);
  itemsUsed.push(r.records.filter((x) => x.source === 'placement').length);
}
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const within = (t: number): number => errs.filter((e) => e <= t).length / errs.length;
console.log(`placement  n=${errs.length}  MAE=${mean(errs).toFixed(2)} grades  ≤0.5: ${(within(0.5) * 100).toFixed(0)}%  ≤1.0: ${(within(1) * 100).toFixed(0)}%`);
console.log(`           items=${mean(itemsUsed).toFixed(1)}  wrong answers during placement=${mean(wrongs).toFixed(2)}`);

// ── 2. Realised success rate and progress over 4 simulated weeks ────────────
const rates: number[] = [];
const mastered: number[] = [];
const proficient: number[] = [];
const gradeShift: number[] = [];
const trackErr: number[] = [];
for (let i = 0; i < Math.min(N, 120); i++) {
  const learner = randomLearner(rng, GRAPH, [0.5, 3.5]);
  const clock = new SimClock();
  let snap = newSnapshot(Math.round(learner.params.g + 5));
  let fa = 0;
  let fc = 0;
  const weekGrades: number[][] = [[], [], [], []];
  for (let day = 0; day < 28; day++) {
    const r = runSession(learner, snap, clock, rng, { items: 12, targetP: 0.85, seed: 1000 * i + day });
    snap = r.snapshot;
    for (const rec of r.records) if (rec.attempt === 1) weekGrades[Math.floor(day / 7)]!.push(GRAPH.get(rec.skill).grade);
    if (day > 0) {
      fa += r.firstAttempts;
      fc += r.firstCorrect;
    }
    clock.advance(DAY_MS - 12 * 9_000);
  }
  rates.push(fc / fa);
  mastered.push(Object.values(snap.skills).filter((s) => s.masteredAt !== undefined).length);
  proficient.push(Object.values(snap.skills).filter((s) => s.proficientAt !== undefined).length);
  gradeShift.push(mean(weekGrades[3]!) - mean(weekGrades[0]!));
  // Tracking: engine μ vs true θ on skills with ≥ 10 observations.
  for (const [id, st] of Object.entries(snap.skills)) {
    if (st.n >= 10) trackErr.push(Math.abs(st.mu - learner.theta.get(id)!));
  }
}
rates.sort((a, b) => a - b);
console.log(
  `success    mean=${mean(rates).toFixed(3)}  p10=${rates[Math.floor(rates.length * 0.1)]!.toFixed(3)}  p90=${rates[Math.floor(rates.length * 0.9)]!.toFixed(3)}  (target 0.85)`,
);
console.log(`progress   after 28 days: mastered=${mean(mastered).toFixed(1)} proficient=${mean(proficient).toFixed(1)}  practised-grade shift week1→4=${mean(gradeShift).toFixed(2)}`);
console.log(`tracking   |μ − θ_true| on skills with n≥10: mean=${mean(trackErr).toFixed(2)} logits (n=${trackErr.length})`);
