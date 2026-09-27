/**
 * Today's challenges for the year on the bar (DESIGN A-29, §1.9). It took the
 * daily quest card's place on the home.
 *   A  big picture tiles with a tick on the done ones and a gift at the end;
 *      no text (a speaker button says what the tiles are). Only what can be
 *      played now is shown (no locked tiles for pre-readers).
 *   B/C a card: one row per challenge, done ones ticked, the rest to play;
 *      before placement only the practice opens.
 * Deliberately absent: time left, resets, anything about missing a day
 * (DESIGN §5.3). The gift stays an unannounced surprise until it arrives.
 */
import type { JSX } from 'preact';
import { launchMode } from '../../app/actions';
import { now, speaker } from '../../app/services';
import { challengeOptions, prepareChallenge, todayView, type ChallengeView } from '../../app/yearActions';
import { getBand } from '../../bands/registry';
import { unlockAudio } from '../../audio/sfx';
import type { Profile } from '../../core/profile';
import type { IconName } from '../components/Icon';
import { Icon } from '../components/Icon';
import { useT } from '../hooks';
import type { Translator } from '../../i18n/i18n';
import { SPRINT_ITEMS } from '../../modes/sprint/timing';
import { yearLabel } from './YearBar';
import './years.css';

const PUZZLE_ICON: Record<string, IconName> = { pattern: 'pattern', balance: 'scale', estimate: 'ruler', logic: 'grid', crypt: 'key' };

function iconOf(v: ChallengeView): IconName {
  const c = v.challenge;
  if (c.kind === 'puzzle') return PUZZLE_ICON[c.puzzleType ?? ''] ?? 'puzzle';
  if (c.kind === 'fracdec') return 'fraction';
  if (c.kind === 'spark') return 'flame';
  return (v.mode?.icon as IconName | undefined) ?? 'play';
}

function nameOf(v: ChallengeView, t: Translator): string {
  const c = v.challenge;
  switch (c.kind) {
    case 'practice':
      return t('year.today.practice');
    case 'puzzle':
      return t('year.today.puzzle');
    case 'fracdec':
      return t('year.today.fracdec');
    case 'spark':
      return t('year.today.spark');
    default:
      return v.mode ? t(v.mode.titleKey) : c.id;
  }
}

function subOf(v: ChallengeView, p: Profile, year: number, t: Translator): string {
  const c = v.challenge;
  if (!v.done && !p.placement.done && c.kind !== 'practice') return t('year.today.locked');
  if (!v.mode) return t('year.today.off');
  if (c.kind === 'puzzle') return t.dyn(`puzzle.type.${c.puzzleType}`);
  const items = challengeOptions(c, p, year, v.mode).items ?? (c.kind === 'sprint' ? SPRINT_ITEMS : getBand(p.band).quickItems);
  const count = t('year.today.items', { n: items });
  // The practice names its mode when it is not the number trail (Balance in a year with nothing else).
  return c.kind === 'practice' && v.mode.id !== 'hop' ? `${t(v.mode.titleKey)} · ${count}` : count;
}

function start(v: ChallengeView, year: number): void {
  const r = prepareChallenge(v.challenge, year);
  if (!r) return;
  unlockAudio();
  launchMode(r.mode, r.opts);
}

function TodayA({ p, year }: { p: Profile; year: number }): JSX.Element | null {
  const t = useT();
  const view = todayView(p, year, now());
  if (!view) return null;
  const shown = view.items.filter((i) => i.open || i.done);
  if (!shown.length) return null;
  return (
    <div class="today today-a">
      <button type="button" class="icon-btn small today-say" aria-label={t('common.speaker')} onClick={() => speaker.say('voice.today', {}, p.locale)}>
        <Icon name="speaker" size={26} />
      </button>
      <div class="today-tiles">
        {shown.map((v) => {
          const name = nameOf(v, t);
          return (
            <button
              type="button"
              class={`today-tile today-${v.challenge.kind}${v.done ? ' done' : ''}`}
              data-challenge={v.challenge.id}
              aria-label={v.done ? t('year.today.done', { name }) : name}
              disabled={!v.open}
              onClick={() => start(v, year)}
            >
              <Icon name={iconOf(v)} size={40} />
              {v.done && (
                <span class="today-tick">
                  <Icon name="check" size={18} />
                </span>
              )}
            </button>
          );
        })}
        <span class={`today-gift${view.complete ? ' open' : ''}`}>
          <Icon name={view.complete ? 'check' : 'gift'} size={30} />
        </span>
      </div>
    </div>
  );
}

function TodayBC({ p, year }: { p: Profile; year: number }): JSX.Element | null {
  const t = useT();
  const view = todayView(p, year, now());
  if (!view) return null;
  return (
    <section class={`card today today-b today-${p.band.toLowerCase()}`}>
      <div class="today-head">
        <h2>{t('year.today.title')}</h2>
        <span class="today-count">{t('year.today.progress', { done: view.done, total: view.items.length })}</span>
      </div>
      <p class="muted">{t('year.today.how', { year: yearLabel(t, year) })}</p>
      <ul class="today-list">
        {view.items.map((v) => (
          <li>
            <button
              type="button"
              class={`today-row today-${v.challenge.kind}${v.done ? ' done' : ''}${v.open ? ' open' : ''}`}
              data-challenge={v.challenge.id}
              disabled={!v.open}
              onClick={() => start(v, year)}
            >
              <span class="today-icon">
                <Icon name={iconOf(v)} size={24} />
              </span>
              <span class="today-text">
                <span class="today-name">{nameOf(v, t)}</span>
                <small class="muted">{subOf(v, p, year, t)}</small>
              </span>
              <span class="today-state">
                <Icon name={v.done ? 'check' : v.open ? 'play' : 'lock'} size={18} solid={!v.done && v.open} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {view.complete && <p class="note">{t('year.today.complete')}</p>}
    </section>
  );
}

export function TodayCard({ p, year }: { p: Profile; year: number }): JSX.Element | null {
  return p.band === 'A' ? <TodayA p={p} year={year} /> : <TodayBC p={p} year={year} />;
}
