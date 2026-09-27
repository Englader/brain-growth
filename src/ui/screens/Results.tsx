/**
 * Session summary. Effort and progress first; never a score in red, never a
 * comparison with anyone else. Gifts are revealed here — decoupled from any
 * single answer so they never read as payment for correctness.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { launchMode, openGift } from '../../app/actions';
import { navigate } from '../../app/router';
import { speaker } from '../../app/services';
import { useStore, type SessionResult } from '../../app/store';
import { play as sfx } from '../../audio/sfx';
import { getBand } from '../../bands/registry';
import { ACHIEVEMENTS } from '../../core/achievements';
import { getCosmetic } from '../../core/rewards/cosmetics';
import { getMode } from '../../modes/registry';
import { numberText } from '../../i18n/render';
import type { Translator } from '../../i18n/i18n';
import { Frog } from '../components/Frog';
import { Icon, iconFor } from '../components/Icon';
import { lookFor, useT } from '../hooks';

function sprintMessage(r: NonNullable<SessionResult['sprint']>, t: Translator): string {
  const secs = (ms: number): string => numberText(Math.round(ms / 100) / 10, t.locale, 1);
  if (r.noClock) return t('sprint.noClockDone');
  if (!r.previousBest || r.run.totalMs < r.previousBest.totalMs) return t('sprint.pb', { time: secs(r.run.totalMs) });
  const diff = r.run.totalMs - r.previousBest.totalMs;
  if (diff <= r.previousBest.totalMs * 0.15) return t('sprint.close', { diff: secs(diff) });
  if (r.run.items && r.run.correct / r.run.items >= 0.8) return t('sprint.careful', { n: r.run.correct, total: r.run.items });
  return t('sprint.complete');
}

function GiftBox({ id, onOpen }: { id: string; onOpen: () => void }): JSX.Element {
  const t = useT();
  const profile = useStore((s) => s.profile)!;
  const [open, setOpen] = useState(false);
  const c = getCosmetic(id);
  const look = lookFor(profile);
  return (
    <button
      type="button"
      class={`gift${open ? ' open' : ''}`}
      aria-label={open ? t.dyn(`cos.${id}`) : t('results.tapGift')}
      onClick={() => {
        if (open) return;
        setOpen(true);
        sfx('gift');
        onOpen();
      }}
    >
      {open ? (
        <>
          {c?.slot === 'color' || c?.slot === 'hat' ? (
            <Frog color={c.slot === 'color' ? c.value : look.color} hat={c.slot === 'hat' ? id : undefined} size={64} mood="happy" />
          ) : c?.slot === 'title' ? (
            <Icon name="star" size={40} />
          ) : (
            <span class="swatch-fill big" style={{ background: c?.value }} />
          )}
          <span>{t.dyn(`cos.${id}`)}</span>
        </>
      ) : (
        <>
          <Icon name="gift" size={52} />
          <span>{t('results.tapGift')}</span>
        </>
      )}
    </button>
  );
}

export function Results(): JSX.Element | null {
  const t = useT();
  const r = useStore((s) => s.lastResult);
  const profile = useStore((s) => s.profile);
  useEffect(() => {
    if (r && profile && getBand(profile.band).audio === 'always' && profile.settings.voice) speaker.say('voice.sessionDone', {}, profile.locale);
    if (r?.gifts.length && profile?.band === 'A' && profile.settings.voice) window.setTimeout(() => speaker.say('voice.gift', {}, profile.locale), 1400);
  }, []);
  if (!r || !profile) {
    navigate('/', true);
    return null;
  }
  const band = getBand(profile.band);
  const look = lookFor(profile);
  const bandA = band.id === 'A';
  const again = (): void => {
    const mode = getMode(r.modeId);
    if (mode) launchMode(mode, { ...(r.opts.stretch ? { stretch: true } : {}), ...(r.opts.theme ? { theme: r.opts.theme } : {}) }, true);
    else navigate('/', true);
  };
  const achIcon = (id: string): string => ACHIEVEMENTS.find((a) => a.id === id)?.icon ?? 'star';

  return (
    <div class={`screen results results-${band.id}`}>
      {bandA ? (
        <div class="pet-stage celebrate">
          <Frog color={look.color} hat={look.hat} size={150} mood="happy" />
        </div>
      ) : (
        <h1 class="center">{t('results.title')}</h1>
      )}

      {!bandA && (
        <section class="card summary">
          <p class="big-line">{t('results.practised', { n: r.firstAttempts })}</p>
          {r.fixed > 0 && <p>{t('results.fixed', { n: r.fixed })}</p>}
          {band.showStats && r.firstAttempts > 0 && <p class="muted">{t('results.accuracy', { pct: Math.round((r.firstCorrect / r.firstAttempts) * 100) })}</p>}
          {r.opts.stretch && <p>{t('results.stretch')}</p>}
          {r.placed && <p>{t('results.placed')}</p>}
          {r.sparkLit && (
            <p class="spark">
              <Icon name="flame" solid /> {t('results.sparkLit')}
            </p>
          )}
          {r.sprint && <p class="big-line">{sprintMessage(r.sprint, t)}</p>}
          {r.extras?.map((e) => (
            <p class="extra">{t.dyn(e.key, e.params)}</p>
          ))}
        </section>
      )}
      {bandA && r.sparkLit && (
        <div class="spark-big" aria-label={t('results.sparkLit')}>
          <Icon name="flame" size={56} solid />
        </div>
      )}

      {band.showStats && r.skills.length > 0 && (
        <section class="card">
          <h2>{t('results.skills')}</h2>
          <ul class="meters">
            {r.skills.map((s) => (
              <li>
                <span class="meter-label">{t.dyn(`skill.${s.id}`)}</span>
                <span class="meter">
                  <span class="meter-fill before" style={{ width: `${Math.round(Math.min(s.before, s.after) * 100)}%` }} />
                  <span class="meter-fill gain" style={{ left: `${Math.round(Math.min(s.before, s.after) * 100)}%`, width: `${Math.max(0, Math.round((s.after - s.before) * 100))}%` }} />
                </span>
                <span class="meter-value">{Math.round(s.after * 100)}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!bandA && (r.unlocked.length > 0 || r.mastered.length > 0) && (
        <section class="card">
          {r.unlocked.length > 0 && (
            <>
              <h2>{t('results.unlocked')}</h2>
              <ul class="plain">
                {r.unlocked.map((id) => (
                  <li>
                    <Icon name="sprout" size={18} /> {t.dyn(`skill.${id}`)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {r.mastered.length > 0 && (
            <>
              <h2>{t('results.mastered')}</h2>
              <ul class="plain">
                {r.mastered.map((id) => (
                  <li>
                    <Icon name="star" size={18} /> {t.dyn(`skill.${id}`)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {r.gifts.length > 0 && (
        <section class="card gifts">
          {!bandA && <h2>{t('results.gift')}</h2>}
          <div class="gift-row">
            {r.gifts.map((id) => (
              <GiftBox id={id} onOpen={() => openGift(id)} />
            ))}
          </div>
        </section>
      )}

      {r.achievements.length > 0 && (
        <section class="card">
          {!bandA && <h2>{t('results.trophies')}</h2>}
          <ul class="ach-list">
            {r.achievements.map((id) => (
              <li>
                <span class="ach-icon">
                  <Icon name={iconFor(achIcon(id))} size={bandA ? 40 : 26} />
                </span>
                {!bandA && (
                  <span>
                    <strong>{t.dyn(`ach.${id}.name`)}</strong>
                    <br />
                    <small class="muted">{t.dyn(`ach.${id}.desc`)}</small>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div class="row center-row">
        <button type="button" class="btn big" aria-label={t('common.home')} onClick={() => navigate('/', true)}>
          <Icon name="back" /> {bandA ? null : t('common.home')}
        </button>
        <button type="button" class="btn primary big" aria-label={t('results.again')} onClick={again}>
          <Icon name="play" solid /> {bandA ? null : t('results.again')}
        </button>
      </div>
    </div>
  );
}
