/**
 * "Grown-ups" on the picker and in Settings: opens #/adult, where the
 * parent-PIN gate stands in front of the dashboard (DESIGN A-30). It replaced
 * the 2-second hold, which children could do too.
 */
import type { JSX } from 'preact';
import { navigate } from '../../app/router';
import { Icon } from '../components/Icon';
import { useT } from '../hooks';
import { PinGateScreen } from './screen';

export function GrownupsButton(): JSX.Element {
  const t = useT();
  return (
    <div class="grownups">
      <button
        type="button"
        class="btn grownups-btn"
        onPointerDown={() => void PinGateScreen.preload().catch(() => undefined)}
        onClick={() => navigate('/adult')}
      >
        <Icon name="lock" size={18} /> {t('profiles.grownups')}
      </button>
      <small class="muted">{t('pin.hint')}</small>
    </div>
  );
}
