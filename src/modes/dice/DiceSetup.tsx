/**
 * /intro/dice: pick the two players (avatars, big targets; the active child
 * is picked first). Only children who can race are offered: placement done
 * and Dice Race not switched off for them. The order picked is the turn order.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { canRace, startMatch } from '../../app/diceActions';
import { navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { unlockAudio } from '../../audio/sfx';
import { numberText } from '../../i18n/render';
import { TopBar } from '../../ui/components/common';
import { Icon } from '../../ui/components/Icon';
import { useT } from '../../ui/hooks';
import { Avatar } from '../../ui/screens/Profiles';
import { getDice } from './state';
import './dice.css';

export function DiceSetup(): JSX.Element {
  const t = useT();
  const profile = useStore((s) => s.profile)!;
  const profiles = useStore((s) => s.profiles);
  const meta = useStore((s) => s.meta);
  const racers = profiles.filter((p) => canRace(p, meta?.deviceFlags ?? {}));
  const ids = racers.map((p) => p.id);
  const [picked, setPicked] = useState<string[]>(() => {
    // The last race's pair again, if the child holding the device was in it.
    const last = getDice().lastPids.filter((id) => ids.includes(id));
    if (last.length === 2 && last.includes(profile.id)) return last;
    const first = ids.includes(profile.id) ? [profile.id] : [];
    return racers.length === 2 ? [...first, ...ids.filter((id) => !first.includes(id))] : first;
  });
  const toggle = (id: string): void => {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : [cur[0]!, id]));
  };
  const bandA = profile.band === 'A';
  return (
    <div class="screen dice-setup">
      <TopBar title={t('dice.title')} onBack={() => navigate('/')} />
      {racers.length < 2 ? (
        <p class="card">{t('dice.setup.few')}</p>
      ) : (
        <>
          <p class="muted">{t('dice.setup.how')}</p>
          <h2>{t('dice.setup.pick')}</h2>
          <div class="tile-grid dice-pick">
            {racers.map((p) => {
              const n = picked.indexOf(p.id);
              return (
                <button type="button" class={`player-tile${n >= 0 ? ' on' : ''}`} aria-pressed={n >= 0} onClick={() => toggle(p.id)}>
                  <Avatar p={p} size={72} />
                  <span class="player-name">{p.name}</span>
                  {n >= 0 && <span class="pick-order">{numberText(n + 1, t.locale)}</span>}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            class="btn go big dice-start"
            aria-label={t('dice.setup.start')}
            disabled={picked.length !== 2}
            onClick={() => {
              unlockAudio();
              startMatch(picked);
            }}
          >
            <Icon name="dice" size={bandA ? 44 : 26} />
            {bandA ? null : <span>{t('dice.setup.start')}</span>}
          </button>
        </>
      )}
    </div>
  );
}
