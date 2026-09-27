/**
 * Workshop (DESIGN §1.4, plan step 9a): fractions and area/perimeter by direct
 * manipulation. The engine picks the skill and the difficulty as in every
 * mode; each item is a construction (a fraction bar or a rectangle) and the
 * constructed object is checked, not a typed number. Bands B/C, untimed.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { endSession, nextItem } from '../../app/actions';
import { navigate } from '../../app/router';
import { getState, useStore } from '../../app/store';
import type { PresentedItem } from '../../core/engine/session';
import { fracBarOf, rectOf } from '../../core/items/generators/workshop';
import { LangToggle } from '../../ui/components/common';
import { Icon } from '../../ui/components/Icon';
import { useT } from '../../ui/hooks';
import { useFeedbackTime } from '../feedbackTime';
import { FracBarBoard } from './FracBarBoard';
import { RectBoard } from './RectBoard';
import './workshop.css';

export function WorkshopMode(): JSX.Element | null {
  const t = useT();
  const profile = useStore((s) => s.profile)!;
  const session = useStore((s) => s.session);
  const locale = profile.locale;
  const [cur, setCur] = useState<PresentedItem | null>(null);
  const extraShapes = useRef(0);
  // Pilot feedback time: from a wrong first check (or "show me") until the next item.
  const fb = useFeedbackTime();

  const finish = (completed: boolean): void => {
    fb.flush();
    const answered = getState().session?.firstAttempts ?? 0;
    const n = extraShapes.current;
    endSession(completed, n ? { extras: [{ key: 'workshop.results.shapes', params: { n } }] } : {});
    navigate(completed || answered > 0 ? '/results' : '/', true);
  };

  const load = (): void => {
    fb.feedback(false);
    const p = nextItem();
    if (!p) {
      finish(true);
      return;
    }
    fb.shown(p);
    setCur(p);
  };

  useEffect(() => {
    load();
  }, []);

  if (!cur || !session) return null;
  const planned = session.engine.planned;
  const done = session.engine.stats.firstPresented;
  const bar = fracBarOf(cur.item);
  const rect = bar ? null : rectOf(cur.item);
  const boardKey = `${cur.item.key}#${cur.attempt}`;

  return (
    <div class={`play ws-play ws-on-${bar ? 'bar' : 'grid'}`}>
      <header class="play-head">
        <button type="button" class="icon-btn" aria-label={t('play.exit')} onClick={() => finish(false)}>
          <Icon name="close" />
        </button>
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={planned} aria-valuenow={done} aria-label={t('play.progress', { n: done, total: planned })}>
          <div class="progress-fill" style={{ width: `${Math.min(100, (done / planned) * 100)}%` }} />
        </div>
        <LangToggle />
      </header>
      {bar && <FracBarBoard key={boardKey} presented={cur} task={bar} locale={locale} band={profile.band} onNext={load} onWrong={() => fb.feedback(true)} />}
      {rect && (
        <RectBoard
          key={boardKey}
          presented={cur}
          task={rect}
          locale={locale}
          band={profile.band}
          onNext={load}
          onWrong={() => fb.feedback(true)}
          onExtraShape={() => {
            extraShapes.current++;
          }}
        />
      )}
      {!bar && !rect && (
        <section class="controls">
          <button type="button" class="btn primary big" onClick={load}>
            {t('workshop.next')}
          </button>
        </section>
      )}
    </div>
  );
}
