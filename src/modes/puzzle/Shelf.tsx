/**
 * The puzzle shelf: free choice of puzzle type. Band A sees two big picture
 * tiles and nothing to read; Bands B/C see a card per type and the
 * "Harder one" chip (target success 0.55 instead of 0.75).
 */
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { speaker } from '../../app/services';
import { getBand } from '../../bands/registry';
import type { Profile } from '../../core/profile';
import { getPuzzleType } from '../../puzzles';
import { TopBar } from '../../ui/components/common';
import { Icon, type IconName } from '../../ui/components/Icon';
import { useT } from '../../ui/hooks';
import { Tile, Weight } from './art';

export const TYPE_ICON: Record<string, IconName> = {
  pattern: 'pattern',
  balance: 'scale',
  estimate: 'ruler',
  logic: 'grid',
  crypt: 'key',
};

function PictureA({ type }: { type: string }): JSX.Element {
  if (type === 'balance') {
    return (
      <span class="pz-shelf-art">
        <Icon name="scale" size={56} />
        <Weight id="b2" size={30} />
      </span>
    );
  }
  return (
    <span class="pz-shelf-art">
      <Tile id="t0" size={30} />
      <Tile id="t1" size={30} />
      <Tile id="t0" size={30} />
      <span class="slot-q">?</span>
    </span>
  );
}

export function Shelf({ profile, types: typeIds, year, harder, setHarder, onPick, onExit }: {
  profile: Profile;
  /** Types offered (the school year's, DESIGN A-29), in shelf order. */
  types: readonly string[];
  year: number | undefined;
  harder: boolean;
  setHarder: (v: boolean) => void;
  onPick: (type: string) => void;
  onExit: () => void;
}): JSX.Element {
  const t = useT();
  const types = typeIds.map(getPuzzleType);
  const bandA = profile.band === 'A';
  const voiceOn = profile.settings.voice && getBand(profile.band).audio !== 'off';
  useEffect(() => {
    if (bandA && voiceOn) speaker.say('voice.puzzle.shelf', {}, t.locale);
  }, []);

  if (bandA) {
    return (
      <div class="screen puzzle-shelf shelf-a">
        <TopBar onBack={onExit} />
        <div class="pz-shelf-tiles">
          {types.map((d) => (
            <button type="button" class={`btn pz-shelf-tile pz-type-${d.id}`} data-type={d.id} aria-label={t.dyn(`puzzle.type.${d.id}`)} onClick={() => onPick(d.id)}>
              <PictureA type={d.id} />
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div class="screen puzzle-shelf">
      <TopBar title={t('puzzle.title')} onBack={onExit} />
      {year !== undefined && <p class="pz-year">{t('year.label', { n: String(year) })}</p>}
      <p class="muted">{t('puzzle.desc')}</p>
      <div class="row wrap">
        <button type="button" class={`chip pz-harder${harder ? ' on' : ''}`} aria-pressed={harder} onClick={() => setHarder(!harder)}>
          <Icon name="mountain" size={18} /> {harder ? t('puzzle.harderOn') : t('puzzle.harder')}
        </button>
      </div>
      {types.map((d) => (
        <section class={`card mode-card pz-type-${d.id}`}>
          <div class="mode-head">
            <span class="mode-icon">
              <Icon name={TYPE_ICON[d.id] ?? 'puzzle'} size={28} />
            </span>
            <div>
              <h2>{t.dyn(`puzzle.type.${d.id}`)}</h2>
              <p class="muted">{t.dyn(`puzzle.about.${d.id}`)}</p>
            </div>
          </div>
          <button type="button" class="btn primary" data-type={d.id} onClick={() => onPick(d.id)}>
            <Icon name="play" solid /> {t('puzzle.play')}
          </button>
        </section>
      ))}
    </div>
  );
}
