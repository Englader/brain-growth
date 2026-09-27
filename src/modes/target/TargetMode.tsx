/**
 * Target ("Make it"): combine dealt numbers with operators to hit a target
 * (DESIGN §1.4). The engine picks the skill and the difficulty as in every
 * mode; the item is a deal (makeTen / makeIt generators). Band A plays the
 * text-free make-10 board, Bands B/C the tap-merge board.
 *
 * Items end only in a solve or a "show me"; nothing returns (maxReturns 0)
 * and nothing is timed.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { endSession, nextItem } from '../../app/actions';
import { navigate } from '../../app/router';
import { speaker } from '../../app/services';
import { getState, useStore } from '../../app/store';
import { getBand } from '../../bands/registry';
import type { PresentedItem } from '../../core/engine/session';
import { targetData } from '../../core/items/generators/makeIt';
import { customVoice } from '../../i18n/render';
import { LangToggle } from '../../ui/components/common';
import { Icon } from '../../ui/components/Icon';
import { lookFor, useT } from '../../ui/hooks';
import { TargetA } from './TargetA';
import { TargetBoard } from './TargetBoard';
import './target.css';

export function TargetMode(): JSX.Element | null {
  const t = useT();
  const profile = useStore((s) => s.profile)!;
  const session = useStore((s) => s.session);
  const band = getBand(profile.band);
  const locale = profile.locale;
  const look = lookFor(profile);
  const [cur, setCur] = useState<PresentedItem | null>(null);
  const extraWays = useRef(0);

  const speak = (p: PresentedItem): void => {
    if (!profile.settings.voice) return;
    const v = customVoice(p.item);
    if (v) speaker.say(v.key, v.params ?? {}, locale);
  };

  const finish = (completed: boolean): void => {
    const answered = getState().session?.firstAttempts ?? 0;
    const n = extraWays.current;
    endSession(completed, n ? { extras: [{ key: 'target.results.ways', params: { n } }] } : {});
    navigate(completed || answered > 0 ? '/results' : '/', true);
  };

  const load = (): void => {
    const p = nextItem();
    if (!p) {
      finish(true);
      return;
    }
    setCur(p);
    if (band.audio === 'always') speak(p);
  };

  useEffect(() => {
    load();
    return () => speaker.stop();
  }, []);

  // Language switched mid-item: same deal, re-rendered (and re-spoken for pre-readers).
  useEffect(() => {
    if (cur && band.audio === 'always') speak(cur);
  }, [locale]);

  if (!cur || !session) return null;
  const data = targetData(cur.item);
  const planned = session.engine.planned;
  const done = session.engine.stats.firstPresented;

  return (
    <div class={`play target-play target-${band.id === 'A' ? 'a' : 'bc'}`}>
      <header class="play-head">
        <button type="button" class="icon-btn" aria-label={t('play.exit')} onClick={() => finish(false)}>
          <Icon name="close" />
        </button>
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={planned} aria-valuenow={done} aria-label={t('play.progress', { n: done, total: planned })}>
          <div class="progress-fill" style={{ width: `${Math.min(100, (done / planned) * 100)}%` }} />
        </div>
        {band.audio !== 'off' && (
          <button type="button" class="icon-btn" aria-label={t('common.speaker')} onClick={() => speak(cur)}>
            <Icon name="speaker" />
          </button>
        )}
        <LangToggle />
      </header>
      {data &&
        (band.id === 'A' ? (
          <TargetA key={`${cur.item.key}#${cur.attempt}`} presented={cur} data={data} locale={locale} band={band} look={look} onNext={load} />
        ) : (
          <TargetBoard
            key={`${cur.item.key}#${cur.attempt}`}
            presented={cur}
            data={data}
            locale={locale}
            band={band}
            look={look}
            onNext={load}
            onExtraWay={() => {
              extraWays.current++;
            }}
          />
        ))}
    </div>
  );
}
