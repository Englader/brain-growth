/**
 * The end of a race: everyone celebrates their own journey. One card per
 * player, in turn order, the same size, each in that player's language and
 * theme; no winner, place, score or comparison, and nothing is kept as a
 * win/loss history. The race ends at the end of a round, so ties happen.
 */
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { startMatch } from '../../app/diceActions';
import { navigate } from '../../app/router';
import { speaker } from '../../app/services';
import { useStore } from '../../app/store';
import { getBand } from '../../bands/registry';
import { Icon } from '../../ui/components/Icon';
import { useT } from '../../ui/hooks';
import { Avatar } from '../../ui/screens/Profiles';
import { playerT, themeOf } from './parts';
import { getDice, setDice, type PlayerResult } from './state';

export function DiceResults({ results }: { results: PlayerResult[] }): JSX.Element {
  const t = useT();
  const active = useStore((s) => s.profile);
  const profiles = useStore((s) => s.profiles);
  useStore((s) => s.locales); // each card follows its language bundle as it arrives
  const bandA = active?.band === 'A';

  useEffect(() => {
    // Pre-readers hear that the race is done (in their own language); names are never spoken.
    const a = results.map((r) => profiles.find((p) => p.id === r.pid)).find((p) => p && getBand(p.band).audio === 'always' && p.settings.voice);
    if (a) speaker.say('voice.sessionDone', {}, a.locale);
  }, []);

  const leave = (): void => {
    setDice({ results: null });
    navigate('/', true);
  };
  const again = (): void => {
    const pids = getDice().lastPids;
    setDice({ results: null });
    if (!startMatch(pids)) navigate('/intro/dice', true);
  };

  return (
    <div class="screen dice-results">
      <div class="dice-hero" aria-hidden="true">
        <svg viewBox="0 0 120 44" class="hero-pond">
          <ellipse cx="60" cy="26" rx="56" ry="16" class="pond-water" />
          <ellipse cx="38" cy="24" rx="12" ry="6" class="pond-pad" />
          <ellipse cx="80" cy="30" rx="10" ry="5" class="pond-pad" />
        </svg>
      </div>
      <h1 class="center">{t('dice.results.title')}</h1>
      {results.map((r) => {
        const p = profiles.find((x) => x.id === r.pid);
        if (!p) return null;
        const tp = playerT(p);
        return (
          <section class="card dice-result dice-themed" {...themeOf(p)}>
            <div class="dice-result-head">
              <Avatar p={p} size={64} />
              <div class="grow">
                <h2>{p.name}</h2>
                <p class="big-line">{tp.dyn(r.line.key, r.line.params)}</p>
              </div>
            </div>
            <p>{tp('dice.results.items', { n: r.items })}</p>
            {r.result.sparkLit && (
              <p class="spark">
                <Icon name="flame" solid /> {tp('results.sparkLit')}
              </p>
            )}
            {r.result.gifts.length > 0 && (
              <p class="dice-gift">
                <Icon name="gift" /> {tp('dice.results.gift')}
              </p>
            )}
          </section>
        );
      })}
      <div class="row center-row">
        <button type="button" class="btn big" aria-label={t('common.home')} onClick={leave}>
          <Icon name="back" /> {bandA ? null : t('common.home')}
        </button>
        <button type="button" class="btn primary big" aria-label={t('dice.results.again')} onClick={again}>
          <Icon name="dice" /> {bandA ? null : t('dice.results.again')}
        </button>
      </div>
    </div>
  );
}
