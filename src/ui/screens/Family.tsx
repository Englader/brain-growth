/**
 * Family board: every player on this device plus cards received from other
 * devices via links. Scores are effort- and growth-normalised per band
 * (core/league.ts), so a 6-year-old and a 13-year-old share one board fairly.
 */
import type { JSX } from 'preact';
import { acceptRival, myCard, removeRival, rivalLink, toast } from '../../app/actions';
import { navigate } from '../../app/router';
import { repo } from '../../app/services';
import { getState, setState, useStore } from '../../app/store';
import { wildcardForWeek, type LeagueParts, type RivalCard } from '../../core/league';
import { getCosmetic } from '../../core/rewards/cosmetics';
import { weekKey } from '../../core/time';
import { TopBar } from '../components/common';
import { Frog } from '../components/Frog';
import { Icon } from '../components/Icon';
import { useT } from '../hooks';

const PARTS: Array<keyof LeagueParts> = ['consistency', 'effort', 'growth', 'grit', 'wildcard'];

function CardAvatar({ c }: { c: RivalCard }): JSX.Element {
  const cos = getCosmetic(c.avatar);
  if (c.band === 'C' || cos?.slot === 'theme') {
    return (
      <span class="monogram" style={{ background: cos?.value ?? '#818cf8', width: '44px', height: '44px', fontSize: '20px' }}>
        {c.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <Frog color={cos?.value ?? '#4caf50'} size={48} />;
}

function Row({ c, first, local, onRemove }: { c: RivalCard; first: boolean; local: boolean; onRemove?: () => void }): JSX.Element {
  const t = useT();
  const stale = c.week !== weekKey(Date.now());
  return (
    <li class={`league-row${first ? ' first' : ''}${stale ? ' stale' : ''}`}>
      <CardAvatar c={c} />
      <div class="league-main">
        <div class="league-name">
          <strong>{c.name}</strong>
          {first && <Icon name="star" size={18} solid />}
          {!local && <small class="muted"> · {stale ? t('family.oldCard') : t('family.otherDevice')}</small>}
        </div>
        <div class="stack-bar" role="img" aria-label={PARTS.map((k) => `${t(`family.part.${k}` as 'family.part.effort')} ${c.parts[k]}`).join(', ')}>
          {PARTS.map((k, i) => (
            <span class={`seg seg-${i + 1}`} style={{ width: `${c.parts[k]}%` }} />
          ))}
        </div>
      </div>
      <div class="league-score">{t('common.points', { n: c.total })}</div>
      {onRemove && (
        <button type="button" class="icon-btn small" aria-label={t('family.remove')} onClick={onRemove}>
          <Icon name="close" size={16} />
        </button>
      )}
    </li>
  );
}

export function Family(): JSX.Element | null {
  const t = useT();
  const p = useStore((s) => s.profile);
  const profiles = useStore((s) => s.profiles);
  useStore((s) => s.toast);
  if (!p) return null;
  const local = profiles.map((x) => myCard(x));
  const localIds = new Set(local.map((c) => c.pid));
  const remote = Object.values(repo.rivals()).filter((c) => !localIds.has(c.pid));
  const all = [...local, ...remote].sort((a, b) => b.total - a.total);
  const top = all[0]?.total ?? 0;
  const mine = myCard(p);
  const share = async (): Promise<void> => {
    const url = rivalLink(mine);
    const text = t('family.shareText', { name: p.name, total: mine.total });
    if (navigator.share) {
      await navigator.share({ title: t('app.name'), text, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(`${text} ${url}`).catch(() => undefined);
    toast(t('family.copied'));
  };
  const wild = wildcardForWeek(weekKey(Date.now()));
  return (
    <div class="screen family">
      <TopBar title={t('family.title')} onBack={() => navigate('/')} />
      <p class="muted">{t('family.explain')}</p>
      <section class="card">
        <h2>{t('family.week')}</h2>
        <ul class="league">
          {all.map((c) => (
            <Row c={c} first={top > 0 && c.total === top} local={localIds.has(c.pid)} {...(!localIds.has(c.pid) ? { onRemove: () => { removeRival(c.pid); setState({}); } } : {})} />
          ))}
        </ul>
        {all.length < 2 && <p class="muted">{t('family.empty')}</p>}
        <div class="legend-row">
          {PARTS.map((k, i) => (
            <span>
              <i class={`lkey seg-${i + 1}`} /> {t(`family.part.${k}` as 'family.part.effort')}
            </span>
          ))}
        </div>
      </section>
      <section class="card">
        <h2>{t('family.wildcard')}</h2>
        <p>{t.dyn(`family.wild.${wild}`)}</p>
      </section>
      <button type="button" class="btn primary big" onClick={() => void share()}>
        <Icon name="share" /> {t('family.share')}
      </button>
    </div>
  );
}

/** Route #/rival/<payload>: confirm adding a card from another device. */
export function RivalImport({ payload }: { payload: string }): JSX.Element {
  const t = useT();
  const pending = useStore((s) => s.pendingRival);
  const card = pending ?? null;
  if (!card) {
    return (
      <div class="screen">
        <TopBar onBack={() => navigate('/', true)} />
        <p class="warn">{t('family.badLink')}</p>
      </div>
    );
  }
  void payload;
  return (
    <div class="screen">
      <TopBar onBack={() => navigate('/', true)} />
      <section class="card center">
        <CardAvatar c={card} />
        <h2>{t('family.addTitle', { name: card.name })}</h2>
        <p>{t('common.points', { n: card.total })}</p>
        <div class="row center-row">
          <button type="button" class="btn" onClick={() => { setState({ pendingRival: null }); navigate('/', true); }}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            class="btn primary"
            onClick={() => {
              acceptRival(card);
              navigate(getState().profile ? '/family' : '/', true);
            }}
          >
            {t('family.add')}
          </button>
        </div>
      </section>
    </div>
  );
}

