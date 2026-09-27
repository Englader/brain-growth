/**
 * App-wide notice in a second tab (DESIGN A-8, single writer): another tab
 * holds the Web Lock, so this one only shows progress and saves nothing.
 */
import type { JSX } from 'preact';
import { useStore } from '../../app/store';
import { Icon } from '../components/Icon';
import { useT } from '../hooks';
import './storage.css';

export function OtherTabNotice(): JSX.Element | null {
  const otherTab = useStore((s) => s.otherTab);
  const t = useT();
  if (!otherTab) return null;
  return (
    <p class="warn other-tab" role="status">
      <Icon name="lock" size={22} />
      <span>{t('storage.otherTab')}</span>
    </p>
  );
}
