/**
 * "Who's playing?" (DESIGN A-29): the start page on every fresh open once a
 * player exists. One big card per child (avatar, name, the school year they
 * will land on), "+ New player" below the list, the Grown-ups button at the
 * bottom (it opens the parent-PIN gate, DESIGN A-30). With no players the app
 * opens the new-player form instead.
 */
import type { JSX } from 'preact';
import { selectProfile } from '../../app/actions';
import { navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { selectedYear } from '../../app/yearActions';
import { getCosmetic } from '../../core/rewards/cosmetics';
import type { Profile } from '../../core/profile';
import { LangToggle } from '../components/common';
import { Frog } from '../components/Frog';
import { Icon } from '../components/Icon';
import { useT } from '../hooks';
import { GrownupsButton } from '../pin/GrownupsButton';
import { yearLabel } from '../years/YearBar';
import '../years/years.css';

/**
 * A Pro (Band C) player's avatar: the name's initial on their accent colour (no frog; nothing cute in
 * Band C). Before a name is typed (the new-player form) it shows a person outline instead.
 */
export function Monogram({ name, color, size }: { name: string; color: string; size: number }): JSX.Element {
  const initial = name.trim().slice(0, 1).toUpperCase();
  return (
    <span class="monogram" style={{ width: `${size}px`, height: `${size}px`, background: color, fontSize: `${size * 0.42}px` }} aria-hidden="true">
      {initial || <Icon name="user" size={Math.round(size * 0.5)} />}
    </span>
  );
}

export function Avatar({ p, size = 72 }: { p: Profile; size?: number }): JSX.Element {
  if (p.band === 'C') return <Monogram name={p.name} color={getCosmetic(p.cosmetics.equipped.theme ?? 'theme.indigo')?.value ?? '#818cf8'} size={size} />;
  const color = getCosmetic(p.cosmetics.equipped.color ?? p.avatar)?.value ?? '#4caf50';
  return <Frog color={color} hat={p.cosmetics.equipped.hat} size={size} />;
}

export function Profiles(): JSX.Element {
  const t = useT();
  const profiles = useStore((s) => s.profiles);
  // Re-render when device flags change (they decide which years have something to play).
  useStore((s) => s.meta);
  return (
    <div class="screen picker" data-theme="lagoon">
      <header class="topbar">
        <span class="app-title">{t('app.name')}</span>
        <span class="grow" />
        <LangToggle />
      </header>
      <h1 class="center">{t('profiles.title')}</h1>
      <ul class="player-list">
        {profiles.map((p) => (
          <li>
            <button type="button" class="player-card" data-pid={p.id} onClick={() => selectProfile(p.id)}>
              <Avatar p={p} size={56} />
              <span class="player-card-text">
                <span class="player-name">{p.name}</span>
                <span class="player-year muted">{yearLabel(t, selectedYear(p))}</span>
              </span>
              <span class="player-go">
                <Icon name="play" size={20} solid />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" class="btn big add-player" onClick={() => navigate('/new')}>
        <Icon name="plus" /> {t('profiles.add')}
      </button>
      <div class="picker-foot">
        <GrownupsButton />
      </div>
    </div>
  );
}
