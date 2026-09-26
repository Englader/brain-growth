import type { JSX } from 'preact';
import { equip, openGift } from '../../app/actions';
import { navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { COSMETICS, type CosmeticSlot } from '../../core/rewards/cosmetics';
import { TopBar } from '../components/common';
import { Frog } from '../components/Frog';
import { Icon } from '../components/Icon';
import { lookFor, useT } from '../hooks';

export function Wardrobe(): JSX.Element | null {
  const t = useT();
  const p = useStore((s) => s.profile);
  if (!p) return null;
  const look = lookFor(p);
  const slots: CosmeticSlot[] = p.band === 'C' ? ['theme', 'title'] : ['color', 'hat', 'pad'];
  return (
    <div class="screen wardrobe">
      <TopBar title={t('wardrobe.title')} onBack={() => navigate('/')} />
      {p.band !== 'C' && (
        <div class="pet-stage">
          <Frog color={look.color} hat={look.hat} size={120} mood="happy" />
        </div>
      )}
      {p.rewards.pending.length > 0 && (
        <div class="row wrap center-row">
          {p.rewards.pending.map((id) => (
            <button type="button" class="btn primary" onClick={() => openGift(id)}>
              <Icon name="gift" /> {t('results.tapGift')}
            </button>
          ))}
        </div>
      )}
      {slots.map((slot) => {
        const items = COSMETICS.filter((c) => c.slot === slot && c.bands.includes(p.band));
        const current = p.cosmetics.equipped[slot];
        return (
          <section class="card">
            <h2>{t(`wardrobe.slot.${slot}` as 'wardrobe.slot.color')}</h2>
            <div class="closet">
              {(slot === 'hat' || slot === 'title') && (
                <button type="button" class={`closet-item${!current ? ' on' : ''}`} aria-pressed={!current} onClick={() => equip(slot, null)}>
                  <span class="closet-preview">
                    <Icon name="close" />
                  </span>
                  <span>{t('wardrobe.none')}</span>
                </button>
              )}
              {items.map((c) => {
                const owned = p.cosmetics.owned.includes(c.id);
                const on = current === c.id;
                return (
                  <button
                    type="button"
                    class={`closet-item${on ? ' on' : ''}${owned ? '' : ' locked'}`}
                    disabled={!owned}
                    aria-pressed={on}
                    onClick={() => equip(slot, c.id)}
                  >
                    <span class="closet-preview">
                      {!owned ? (
                        <Icon name="question" />
                      ) : slot === 'color' ? (
                        <Frog color={c.value} size={48} />
                      ) : slot === 'hat' ? (
                        <Frog color={look.color} hat={c.id} size={48} />
                      ) : slot === 'title' ? (
                        <Icon name="star" />
                      ) : (
                        <span class="swatch-fill" style={{ background: c.value }} />
                      )}
                    </span>
                    <span>{owned ? t.dyn(`cos.${c.id}`) : t('wardrobe.hidden')}</span>
                    {on && <small class="muted">{t('wardrobe.wearing')}</small>}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
