import type { JSX } from 'preact';
import { signOut, updateSettings } from '../../app/actions';
import { navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { getBand } from '../../bands/registry';
import { LangToggle, TopBar } from '../components/common';
import { Icon } from '../components/Icon';
import { useT } from '../hooks';
import { GrownupsButton } from '../pin/GrownupsButton';

export function Settings(): JSX.Element | null {
  const t = useT();
  const p = useStore((s) => s.profile);
  if (!p) return null;
  const band = getBand(p.band);
  const toggle = (label: string, on: boolean, change: (v: boolean) => void, help?: string): JSX.Element => (
    <label class="switch-row">
      <input type="checkbox" checked={on} onChange={(e) => change((e.currentTarget as HTMLInputElement).checked)} />
      <span>
        {label}
        {help && <small class="muted"> — {help}</small>}
      </span>
    </label>
  );
  return (
    <div class="screen settings">
      <TopBar title={t('settings.title')} onBack={() => navigate('/')} right={<span />} />
      <div class="stack">
        <div class="row">
          <LangToggle />
        </div>
        {toggle(t('settings.sound'), p.settings.sound, (v) => updateSettings({ sound: v }))}
        {toggle(t('settings.voice'), p.settings.voice, (v) => updateSettings({ voice: v }))}
        {band.timersAllowed && toggle(t('settings.noClock'), p.settings.noClock, (v) => updateSettings({ noClock: v }), t('settings.noClockHelp'))}
        {band.companion === 'pet' && (
          <label class="field">
            <span>{t('settings.petName')}</span>
            <input
              type="text"
              maxLength={16}
              value={p.settings.petName ?? ''}
              placeholder={t('settings.petDefault')}
              onChange={(e) => updateSettings({ petName: (e.currentTarget as HTMLInputElement).value.trim() || null })}
            />
          </label>
        )}
        <button type="button" class="btn" onClick={signOut}>
          <Icon name="user" /> {t('home.switch')}
        </button>
        <GrownupsButton />
      </div>
    </div>
  );
}
