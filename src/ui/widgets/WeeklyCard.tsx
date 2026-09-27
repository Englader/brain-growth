/**
 * Weekly challenge card on the home screens (plan step 6), one presentation
 * per band:
 *   A  a theme picture to tap and five stones: no text at all (pre-readers);
 *      a speaker button says what the stones are.
 *   B  a card with the theme, five stones and "Play this week's challenge".
 *   C  one compact line.
 * Starting from the card passes `opts.theme`, which boosts the theme's skills
 * in that session. Deliberately absent: days left, reset times, anything that
 * says the week ends (DESIGN §5.3). The prize stays an unspecified gift.
 */
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { launchMode } from '../../app/actions';
import { now, speaker } from '../../app/services';
import { weeklyView, type WeeklyView } from '../../app/weeklyActions';
import { unlockAudio } from '../../audio/sfx';
import type { Profile } from '../../core/profile';
import { weeklyThemeDescKey, weeklyThemeNameKey, WEEKLY_KEYS } from '../../core/weekly';
import { getMode } from '../../modes/registry';
import { Icon } from '../components/Icon';
import { registerHomeWidget } from '../homeWidgets';
import { useT } from '../hooks';
import { ThemePicture } from './ThemePicture';
import './weekly.css';

function start(view: WeeklyView): void {
  const hop = getMode('hop');
  if (!hop) return;
  unlockAudio();
  launchMode(hop, { theme: view.theme.id });
}

function Stones({ view, size = 18 }: { view: WeeklyView; size?: number }): JSX.Element {
  const t = useT();
  const { sessions, target, complete } = view.progress;
  return (
    <div class="stones weekly-stones" role="img" aria-label={t(WEEKLY_KEYS.progress, { done: sessions, target })}>
      {Array.from({ length: target }, (_, i) => (
        <span class={`stone${i < sessions ? ' lit' : ''}`}>{i < sessions ? <Icon name="star" size={size} solid /> : null}</span>
      ))}
      <span class={`weekly-gift${complete ? ' open' : ''}`}>
        <Icon name={complete ? 'check' : 'gift'} size={size + 4} />
      </span>
    </div>
  );
}

function WeeklyA({ p, view }: { p: Profile; view: WeeklyView }): JSX.Element {
  const t = useT();
  const say = (): void => {
    speaker.say(view.progress.complete ? WEEKLY_KEYS.voiceDone : WEEKLY_KEYS.voiceIntro, {}, p.locale);
  };
  return (
    <div class={`weekly weekly-a theme-${view.theme.id}`}>
      <button type="button" class="weekly-pic-btn" aria-label={t(WEEKLY_KEYS.play)} onClick={() => start(view)}>
        <ThemePicture id={view.theme.id} size={84} />
        <span class="weekly-go">
          <Icon name="play" size={22} solid />
        </span>
      </button>
      <div class="weekly-a-side">
        <Stones view={view} size={16} />
        <button type="button" class="icon-btn" aria-label={t('common.speaker')} onClick={say}>
          <Icon name="speaker" size={26} />
        </button>
      </div>
    </div>
  );
}

function WeeklyB({ view }: { view: WeeklyView }): JSX.Element {
  const t = useT();
  const { sessions, target, complete } = view.progress;
  return (
    <section class={`card weekly weekly-b theme-${view.theme.id}`}>
      <div class="weekly-head">
        <ThemePicture id={view.theme.id} size={56} />
        <div class="weekly-titles">
          <h2>{t(WEEKLY_KEYS.title)}</h2>
          <p class="weekly-theme">{t.dyn(weeklyThemeNameKey(view.theme))}</p>
        </div>
      </div>
      <p class="muted">{t.dyn(weeklyThemeDescKey(view.theme))}</p>
      <Stones view={view} />
      <p class="weekly-status">{complete ? t(WEEKLY_KEYS.complete) : sessions === 0 ? t(WEEKLY_KEYS.how) : t(WEEKLY_KEYS.progress, { done: sessions, target })}</p>
      <button type="button" class="btn primary big" onClick={() => start(view)}>
        <Icon name="play" solid /> {t(WEEKLY_KEYS.play)}
      </button>
    </section>
  );
}

function WeeklyC({ view }: { view: WeeklyView }): JSX.Element {
  const t = useT();
  const { sessions, target, complete } = view.progress;
  return (
    <section class={`card weekly weekly-c theme-${view.theme.id}`}>
      <ThemePicture id={view.theme.id} size={40} />
      <div class="weekly-c-text">
        <p class="weekly-theme">{t.dyn(weeklyThemeNameKey(view.theme))}</p>
        <p class="muted">{complete ? t(WEEKLY_KEYS.complete) : t(WEEKLY_KEYS.progress, { done: sessions, target })}</p>
      </div>
      <button type="button" class="btn primary" onClick={() => start(view)}>
        {t(WEEKLY_KEYS.play)}
      </button>
    </section>
  );
}

export function WeeklyCard({ p }: { p: Profile }): JSX.Element | null {
  const view = useMemo(() => weeklyView(p, now()), [p]);
  if (!view) return null;
  if (p.band === 'A') return <WeeklyA p={p} view={view} />;
  if (p.band === 'B') return <WeeklyB view={view} />;
  return <WeeklyC view={view} />;
}

registerHomeWidget({ id: 'weekly', bands: ['A', 'B', 'C'], order: 10, Component: WeeklyCard });
