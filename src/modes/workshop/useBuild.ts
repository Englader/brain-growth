/**
 * What every Workshop board shares: checks, hints and "show me".
 *
 *  - Unlimited checks. The FIRST check of a presentation is the graded one
 *    (submitAnswer: the engine's first attempt, credit 1 − 0.25·tier for the
 *    hint tier reached before it); a wrong one sends the item back later as
 *    usual (band maxReturns). Every later check is graded locally with the same
 *    checker and changes nothing in the engine: gentle feedback only.
 *  - Hints (flag `hints`): up to three tiers (core/workshop/hints).
 *  - "Show me" before any check is a wrong attempt (y = 0); after a check it
 *    only shows the construction.
 */
import { useMemo, useRef, useState } from 'preact/hooks';
import { submitAnswer } from '../../app/actions';
import { flag } from '../../app/services';
import { play as sfx, unlockAudio } from '../../audio/sfx';
import type { AnswerResult, PresentedItem } from '../../core/engine/session';
import { gradeResponse, type GradeResult, type Response } from '../../core/items/grade';
import type { BandId, LocaleId } from '../../core/types';
import type { WorkshopHint } from '../../core/workshop';
import { getLocale } from '../../i18n/locales';

export type BuildPhase = 'build' | 'solved' | 'revealed';

export interface Build {
  phase: BuildPhase;
  /** Checks made on this presentation (the first one was graded). */
  checks: number;
  /** The graded first check was wrong. */
  firstWrong: boolean;
  /** The engine will bring this item back later (after a wrong first check). */
  willReturn: boolean;
  /** Result of the latest check (null before any). */
  last: GradeResult | null;
  /** Highest hint tier taken (0 = none). */
  tier: number;
  hints: WorkshopHint[];
  hintsOn: boolean;
  /** Grade a construction: the engine's first attempt, or a local re-check. */
  check: (response: Response) => GradeResult;
  reveal: () => void;
  takeHint: () => void;
  praise: number;
}

/**
 * `onWrong` fires when the graded first check is wrong, or on "show me" before
 * any check: the wrong-answer feedback opens (pilot feedback time, ../feedbackTime).
 */
export function useBuild(presented: PresentedItem, locale: LocaleId, band: BandId, hints: WorkshopHint[], onWrong?: () => void): Build {
  const [phase, setPhase] = useState<BuildPhase>('build');
  const [checks, setChecks] = useState(0);
  const [firstWrong, setFirstWrong] = useState(false);
  const [willReturn, setWillReturn] = useState(false);
  const [last, setLast] = useState<GradeResult | null>(null);
  const [tier, setTier] = useState(0);
  const shownAt = useRef(performance.now());
  // play.praise3 is "Great hop!": nobody hops in the Workshop.
  const praise = useMemo(() => [1, 2, 4][Math.floor(Math.random() * 3)]!, [presented]);
  const hintsOn = flag('hints') && band !== 'A' && hints.length > 0;

  const meta = (): { latencyMs: number; hint: boolean; hintTier: number; input: 'tap'; hops: number } => ({
    latencyMs: performance.now() - shownAt.current,
    hint: tier > 0,
    hintTier: tier,
    input: 'tap',
    hops: 0,
  });

  const check = (response: Response): GradeResult => {
    unlockAudio();
    let grade: GradeResult;
    if (checks === 0) {
      const r: AnswerResult = submitAnswer(presented, response, meta());
      grade = r.grade;
      if (!grade.invalid) {
        setFirstWrong(!grade.correct);
        setWillReturn(r.willReturn);
        if (!grade.correct) onWrong?.();
      }
    } else grade = gradeResponse(presented.item, response, getLocale(locale).numbers);
    setLast(grade);
    if (grade.invalid) {
      sfx('soft');
      return grade;
    }
    setChecks(checks + 1);
    if (grade.correct) {
      sfx('yes');
      setPhase('solved');
    } else sfx('soft');
    return grade;
  };

  const reveal = (): void => {
    if (phase !== 'build') return;
    if (checks === 0) {
      const r = submitAnswer(presented, { kind: 'built', value: null, repr: '', data: { reveal: 1 } }, { ...meta(), revealed: true });
      setWillReturn(r.willReturn);
      setChecks(1);
      onWrong?.();
    }
    setLast(null);
    setPhase('revealed');
  };

  const takeHint = (): void => {
    if (phase === 'build' && tier < hints.length) setTier(tier + 1);
  };

  return { phase, checks, firstWrong, willReturn, last, tier, hints, hintsOn, check, reveal, takeHint, praise };
}
