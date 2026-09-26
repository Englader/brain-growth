/**
 * Trophy case. Locked achievements show as silhouettes with a hint; secret
 * ones are never listed — only counted, so finding them stays a surprise.
 */
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { markAchievementsSeen } from '../../app/actions';
import { navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { ACHIEVEMENTS, appliesToBand, type AchievementCategory } from '../../core/achievements';
import { getLocale } from '../../i18n/locales';
import { TopBar } from '../components/common';
import { Icon, iconFor } from '../components/Icon';
import { useT } from '../hooks';

const CATS: AchievementCategory[] = ['mastery', 'persistence', 'exploration', 'resilience', 'discovery'];

export function Trophies(): JSX.Element | null {
  const t = useT();
  const p = useStore((s) => s.profile);
  useEffect(() => () => markAchievementsSeen(), []);
  if (!p) return null;
  const fmt = new Intl.DateTimeFormat(getLocale(p.locale).bcp47, { dateStyle: 'medium' });
  const defs = ACHIEVEMENTS.filter((a) => appliesToBand(a, p.band));
  return (
    <div class="screen trophies">
      <TopBar title={t('trophies.title')} onBack={() => navigate('/')} />
      {CATS.map((cat) => {
        const list = defs.filter((a) => a.category === cat);
        const visible = list.filter((a) => !a.secret || p.achievements[a.id]);
        const hidden = list.length - visible.length;
        return (
          <section class="card">
            <h2>{t(`category.${cat}` as 'category.mastery')}</h2>
            <ul class="trophy-grid">
              {visible.map((a) => {
                const got = p.achievements[a.id];
                return (
                  <li class={got ? 'got' : 'locked'}>
                    <span class="trophy-icon">
                      {got ? <Icon name={iconFor(a.icon)} size={30} /> : <Icon name="lock" size={24} />}
                      {got && !got.seen && <span class="new-badge">{t('common.new')}</span>}
                    </span>
                    <span class="trophy-text">
                      <strong>{got ? t.dyn(`ach.${a.id}.name`) : t('trophies.notYet')}</strong>
                      <small>{got ? t.dyn(`ach.${a.id}.desc`) : t.dyn(`ach.${a.id}.hint`)}</small>
                      {got && <small class="muted">{t('trophies.found', { date: fmt.format(got.at) })}</small>}
                    </span>
                  </li>
                );
              })}
            </ul>
            {hidden > 0 && <p class="muted">{t('trophies.secretsLeft', { n: hidden })}</p>}
          </section>
        );
      })}
    </div>
  );
}
