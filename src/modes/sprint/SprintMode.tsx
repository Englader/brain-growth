/**
 * "Race your shadow": opt-in, only on fluency skills the child already holds
 * at Solid or better, never in Band A, never needed for streaks or progress.
 * The opponent is the child's own previous best. A "No clock" switch keeps
 * every reward identical. Feedback time is never on the clock.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { endSession, recentLog, startSession, updateSettings } from '../../app/actions';
import { navigate } from '../../app/router';
import { now } from '../../app/services';
import { getState, useStore } from '../../app/store';
import { selectedYear } from '../../app/yearActions';
import type { SessionOptions } from '../../core/log/types';
import type { Profile } from '../../core/profile';
import type { AnswerResult, PresentedItem } from '../../core/engine/session';
import type { SprintRun } from '../../core/profile';
import { GRAPH } from '../../core/skills';
import { numberText } from '../../i18n/render';
import { TopBar } from '../../ui/components/common';
import { Icon } from '../../ui/components/Icon';
import { useT } from '../../ui/hooks';
import { PlayView } from '../hop/PlayView';
import { parFor, penaltyMs, shadowProgress, SPRINT_ITEMS } from './timing';

const fluencySkills = (): Set<string> => new Set(GRAPH.playableSkills().filter((s) => s.tags.includes('fluency')).map((s) => s.id));

/** The school year (and today's challenge) the card or challenge opened this intro with; the bar's year after a reload (A-29). */
function yearOpts(p: Profile): SessionOptions {
  const lo = getState().launchOpts;
  const year = lo?.year ?? selectedYear(p);
  return { year, ...(lo?.challenge === 'sprint' ? { challenge: lo.challenge } : {}) };
}

export function SprintIntro(): JSX.Element {
  const t = useT();
  const profile = useStore((s) => s.profile)!;
  const [noClock, setNoClock] = useState(profile.settings.noClock);
  const par = parFor(recentLog(profile.id), '', fluencySkills());
  const secs = (ms: number): string => numberText(Math.round(ms / 100) / 10, t.locale, 1);
  const history = profile.sprint.history.slice(-12);
  const maxT = Math.max(1, ...history.map((h) => h.totalMs));
  return (
    <div class="screen">
      <TopBar title={t('sprint.title')} onBack={() => navigate('/')} />
      <div class="stack">
        <div class="card">
          <p>{profile.sprint.best ? t('sprint.intro', { penalty: secs(penaltyMs(par)) }) : t('sprint.firstRun')}</p>
          {profile.sprint.best && <p class="muted">{t('sprint.pb', { time: secs(profile.sprint.best.totalMs) })}</p>}
        </div>
        {history.length > 1 && (
          <div class="card">
            <h2>{t('sprint.history')}</h2>
            <div class="bars" role="img" aria-label={t('sprint.history')}>
              {history.map((h) => (
                <div class="bar" style={{ height: `${Math.max(8, (1 - h.totalMs / maxT) * 70 + 20)}%` }} title={t('sprint.seconds', { s: secs(h.totalMs) })} />
              ))}
            </div>
          </div>
        )}
        <label class="switch-row">
          <input
            type="checkbox"
            checked={noClock}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLInputElement).checked;
              setNoClock(v);
              updateSettings({ noClock: v });
            }}
          />
          <span>
            {t('sprint.noClock')}
            <small class="muted"> — {t('settings.noClockHelp')}</small>
          </span>
        </label>
        <button type="button" class="btn primary big" onClick={() => startSession('sprint', { ...yearOpts(profile), noClock })}>
          <Icon name="bolt" /> {t('sprint.start')}
        </button>
      </div>
    </div>
  );
}

export function SprintMode(): JSX.Element {
  const t = useT();
  const session = useStore((s) => s.session);
  const profile = useStore((s) => s.profile)!;
  const noClock = !!session?.opts.noClock;
  const best = profile.sprint.best;
  const fl = useRef(fluencySkills());
  const log = useRef(recentLog(profile.id).slice());
  const done = useRef<{ splits: number[]; total: number; correct: number; items: number }>({ splits: [], total: 0, correct: 0, items: 0 });
  const itemStart = useRef(performance.now());
  const paused = useRef(false);
  const par = useRef(4000);
  const [elapsed, setElapsed] = useState(0);
  const [penaltyFlash, setPenaltyFlash] = useState<number | null>(null);

  useEffect(() => {
    if (noClock) return;
    const id = window.setInterval(() => {
      if (paused.current) return;
      setElapsed(done.current.total + (performance.now() - itemStart.current));
    }, 100);
    return () => window.clearInterval(id);
  }, [noClock]);

  const onItemShown = (p: PresentedItem): void => {
    itemStart.current = performance.now();
    paused.current = false;
    par.current = parFor(log.current, p.item.skillId, fl.current);
  };
  const onAnswered = (r: AnswerResult, latencyMs: number): void => {
    paused.current = true;
    const d = done.current;
    const pen = r.grade.correct ? 0 : penaltyMs(par.current);
    d.total += latencyMs + pen;
    d.items++;
    d.correct += r.grade.correct ? 1 : 0;
    d.splits.push(Math.round(d.total));
    setElapsed(d.total);
    if (pen && !noClock) {
      setPenaltyFlash(pen);
      window.setTimeout(() => setPenaltyFlash(null), 1200);
    }
  };
  const finish = (completed: boolean): void => {
    const d = done.current;
    const run: SprintRun = { at: now(), totalMs: Math.round(d.total), correct: d.correct, items: d.items, splits: d.splits };
    endSession(completed && d.items > 0, { sprint: { run, noClock } });
    const answered = d.items;
    navigate(answered > 0 ? '/results' : '/', true);
  };

  const total = session?.engine.planned ?? SPRINT_ITEMS;
  const you = Math.min(total, done.current.items);
  const shadow = shadowProgress(best?.splits ?? null, par.current, elapsed, total);
  const secs = (ms: number): string => numberText(Math.round(ms / 100) / 10, t.locale, 1);

  const header = noClock ? null : (
    <div class="race" aria-hidden="true">
      <div class="race-lane">
        <span class="race-label">{t('sprint.you')}</span>
        <div class="race-track">
          <div class="race-dot you" style={{ left: `${(you / total) * 100}%` }} />
        </div>
      </div>
      <div class="race-lane">
        <span class="race-label">{t('sprint.shadow')}</span>
        <div class="race-track">
          <div class="race-dot shadow" style={{ left: `${(shadow / total) * 100}%` }} />
        </div>
      </div>
      <div class="race-clock">
        {t('sprint.seconds', { s: secs(elapsed) })}
        {penaltyFlash && <span class="penalty">{t('sprint.penalty', { s: secs(penaltyFlash) })}</span>}
      </div>
    </div>
  );

  return (
    <PlayView
      fastFeedback
      headerExtra={header}
      onItemShown={onItemShown}
      onAnswered={onAnswered}
      onFeedback={(showing) => {
        if (!showing) itemStart.current = performance.now();
        paused.current = showing || paused.current;
      }}
      onFinished={() => finish(true)}
      onExit={() => finish(false)}
    />
  );
}
