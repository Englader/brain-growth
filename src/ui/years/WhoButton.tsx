/**
 * The switch-player control at the top of every home (DESIGN A-29): the
 * child's own avatar and name with a swap sign. Tapping it goes back to
 * "Who's playing?". Settings keeps its own "Switch player" entry.
 */
import type { JSX } from 'preact';
import { signOut } from '../../app/actions';
import type { Profile } from '../../core/profile';
import { Icon } from '../components/Icon';
import { useT } from '../hooks';
import { Avatar } from '../screens/Profiles';
import './years.css';

export function WhoButton({ p, size = 40 }: { p: Profile; size?: number }): JSX.Element {
  const t = useT();
  return (
    <button type="button" class="who-btn" aria-label={t('year.switchAs', { name: p.name })} onClick={signOut}>
      <Avatar p={p} size={size} />
      <span class="who-name">{p.name}</span>
      <Icon name="swap" size={20} />
    </button>
  );
}
