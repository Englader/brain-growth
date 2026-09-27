/**
 * New player. Age picks the default band; the band can be overridden (a
 * strong 7-year-old can take the Adventurer style). The adult fills this in
 * with or for the child. The form previews the style chosen (its theme on the
 * screen), and the colour choice shows the avatar the child will get: a frog
 * in Bands A/B, the name's initial on an accent colour in Band C, where the
 * colour also becomes the accent of the whole screen.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { addProfile, importBackup, setUiLocale } from '../../app/actions';
import { navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { defaultBandForAge } from '../../core/profile';
import { starterCosmetics } from '../../core/rewards/cosmetics';
import { BAND_IDS, type BandId } from '../../core/types';
import { allLocales } from '../../i18n/locales';
import { numberText } from '../../i18n/render';
import { TopBar } from '../components/common';
import { Frog } from '../components/Frog';
import { useT } from '../hooks';
import { Monogram } from './Profiles';

export function Create(): JSX.Element {
  const t = useT();
  const meta = useStore((s) => s.meta);
  const [name, setName] = useState('');
  const [age, setAge] = useState<number | null>(null);
  const [band, setBand] = useState<BandId | null>(null);
  const [locale, setLocale] = useState(t.locale);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const effBand: BandId = band ?? (age ? defaultBandForAge(age) : 'B');
  const starters = starterCosmetics(effBand, effBand === 'C' ? 'theme' : 'color');
  const chosen = avatar && starters.some((s) => s.id === avatar) ? avatar : starters[0]?.id ?? 'color.green';
  const accent = effBand === 'C' ? starters.find((s) => s.id === chosen)?.value : undefined;
  const ready = name.trim().length > 0 && age !== null;

  const onRestore = async (e: Event): Promise<void> => {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    const r = importBackup(await f.text());
    if (r.ok) navigate('/', true);
    else setErr(t('adult.data.importFail', { reason: r.error ?? '?' }));
  };

  return (
    <div
      class="screen create"
      data-theme={effBand === 'A' ? 'meadow' : effBand === 'C' ? 'slate' : 'lagoon'}
      style={accent ? ({ '--accent': accent } as JSX.CSSProperties) : undefined}
    >
      <TopBar title={t('create.title')} onBack={meta?.profileIds.length ? () => navigate('/') : undefined} />
      <div class="stack">
        <label class="field">
          <span>{t('create.name')}</span>
          <input
            type="text"
            value={name}
            maxLength={24}
            autocomplete="off"
            placeholder={t('create.namePlaceholder')}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
        </label>

        <fieldset class="field">
          <legend>{t('create.age')}</legend>
          <div class="chips">
            {Array.from({ length: 10 }, (_, i) => i + 5).map((a) => (
              <button type="button" class={`chip num${age === a ? ' on' : ''}`} aria-pressed={age === a} onClick={() => setAge(a)}>
                {numberText(a, t.locale)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset class="field">
          <legend>{t('create.band')}</legend>
          <div class="chips">
            {BAND_IDS.map((b) => (
              <button type="button" class={`chip${effBand === b ? ' on' : ''}`} aria-pressed={effBand === b} onClick={() => setBand(b)}>
                {t(`create.band${b}` as 'create.bandA')}
              </button>
            ))}
          </div>
          <small class="muted">{t('create.bandHint')}</small>
        </fieldset>

        <fieldset class="field">
          <legend>{t('create.language')}</legend>
          <div class="chips">
            {allLocales().map((l) => (
              <button type="button" class={`chip${locale === l.id ? ' on' : ''}`} aria-pressed={locale === l.id} lang={l.bcp47} onClick={() => {
                  setLocale(l.id);
                  setUiLocale(l.id);
                }}>
                {l.nativeName}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset class="field">
          <legend>{t('create.color')}</legend>
          <div class="chips swatches">
            {starters.map((c) => (
              <button
                type="button"
                class={`swatch${chosen === c.id ? ' on' : ''}`}
                aria-pressed={chosen === c.id}
                aria-label={t.dyn(`cos.${c.id}`)}
                onClick={() => setAvatar(c.id)}
              >
                {effBand === 'C' ? <Monogram name={name} color={c.value} size={52} /> : <Frog color={c.value} size={52} />}
              </button>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          class="btn primary big"
          disabled={!ready}
          onClick={() => addProfile({ name, age: age!, locale, avatar: chosen, ...(band ? { band } : {}) })}
        >
          {t('create.start')}
        </button>

        <label class="btn ghost small">
          {t('create.restore')}
          <input type="file" accept="application/json,.json" class="visually-hidden" onChange={(e) => void onRestore(e)} />
        </label>
        {err && <p class="warn">{err}</p>}
      </div>
    </div>
  );
}
