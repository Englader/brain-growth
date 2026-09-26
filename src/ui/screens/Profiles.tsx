import type { JSX } from 'preact';
import { selectProfile } from '../../app/actions';
import { navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { getCosmetic } from '../../core/rewards/cosmetics';
import type { Profile } from '../../core/profile';
import { HoldButton, LangToggle } from '../components/common';
import { Frog } from '../components/Frog';
import { Icon } from '../components/Icon';
import { useT } from '../hooks';

export function Avatar({ p, size = 72 }: { p: Profile; size?: number }): JSX.Element {
  if (p.band === 'C') {
    const accent = getCosmetic(p.cosmetics.equipped.theme ?? 'theme.indigo')?.value ?? '#818cf8';
    return (
      <span class="monogram" style={{ width: `${size}px`, height: `${size}px`, background: accent, fontSize: `${size * 0.42}px` }} aria-hidden="true">
        {p.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  const color = getCosmetic(p.cosmetics.equipped.color ?? p.avatar)?.value ?? '#4caf50';
  return <Frog color={color} hat={p.cosmetics.equipped.hat} size={size} />;
}

export function Profiles(): JSX.Element {
  const t = useT();
  const profiles = useStore((s) => s.profiles);
  return (
    <div class="screen picker" data-theme="lagoon">
      <header class="topbar">
        <span class="app-title">{t('app.name')}</span>
        <span class="grow" />
        <LangToggle />
      </header>
      <h1 class="center">{t('profiles.title')}</h1>
      <div class="tile-grid">
        {profiles.map((p) => (
          <button type="button" class="player-tile" onClick={() => selectProfile(p.id)}>
            <Avatar p={p} />
            <span class="player-name">{p.name}</span>
          </button>
        ))}
        <button type="button" class="player-tile add" onClick={() => navigate('/new')}>
          <span class="add-circle">
            <Icon name="plus" size={40} />
          </span>
          <span class="player-name">{t('profiles.add')}</span>
        </button>
      </div>
      <div class="picker-foot">
        <HoldButton label={t('profiles.hold')} onDone={() => navigate('/adult')}>
          <Icon name="lock" size={18} /> {t('profiles.grownups')}
        </HoldButton>
        <small class="muted">{t('profiles.hold')}</small>
      </div>
    </div>
  );
}
