/**
 * /play/dice: the race. Between turns a "pass the device" screen shows the
 * next player's avatar (names are shown, never spoken); the turn itself runs
 * in that player's language and theme; the results celebrate everyone.
 * A reload mid-race resumes it from the match store.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';
import { beginTurn, quitMatch, resumeMatch } from '../../app/diceActions';
import { navigate } from '../../app/router';
import { speaker } from '../../app/services';
import { useStore } from '../../app/store';
import { unlockAudio } from '../../audio/sfx';
import { getBand } from '../../bands/registry';
import { makeT } from '../../i18n/i18n';
import { Icon } from '../../ui/components/Icon';
import { Avatar } from '../../ui/screens/Profiles';
import { DiceBoard } from './DiceBoard';
import { DiceResults } from './DiceResults';
import { DiceTurn } from './DiceTurn';
import { DicePage, PlayerLang } from './parts';
import { exposeForTests, getDice, useDice, type DiceState } from './state';

function PassScreen({ d }: { d: DiceState }): JSX.Element | null {
  const profiles = useStore((s) => s.profiles);
  const match = d.match!;
  const next = profiles.find((x) => x.id === match.players[match.turn]!.id);
  const locale = next?.locale ?? 'mk';
  const bandId = next?.band ?? 'B';
  const t = useMemo(() => makeT(locale, bandId), [locale, bandId]);
  const band = getBand(bandId);
  useEffect(() => {
    if (next && band.audio === 'always' && next.settings.voice) speaker.say('voice.dice.yourTurn', {}, next.locale);
    return () => speaker.stop();
  }, [next?.id]);
  if (!next) return null;
  return (
    <DicePage p={next} class="dice-pass">
      <header class="dice-head">
        <button type="button" class="icon-btn" aria-label={t('dice.quit')} onClick={quitMatch}>
          <Icon name="close" />
        </button>
        <span class="grow" />
        <PlayerLang p={next} t={t} />
      </header>
      <DiceBoard match={match} profiles={profiles} active={match.turn} />
      <section class="pass-card">
        <h1 class="pass-title">{match.lanes.every((l) => l.turns === 0) ? t('dice.pass.first') : t('dice.pass.title')}</h1>
        <Avatar p={next} size={band.id === 'C' ? 96 : 128} />
        <p class="player-name">{next.name}</p>
        <button
          type="button"
          class="btn go big pass-ready"
          aria-label={t('dice.pass.ready')}
          onClick={() => {
            unlockAudio();
            beginTurn();
          }}
        >
          <Icon name="play" size={band.id === 'A' ? 48 : 26} solid />
          {band.id === 'A' ? null : <span>{t('dice.pass.ready')}</span>}
        </button>
      </section>
    </DicePage>
  );
}

export function DiceMode(): JSX.Element | null {
  const d = useDice();
  useEffect(() => {
    exposeForTests();
    const s = getDice();
    if (!s.match && !(s.phase === 'results' && s.results) && !resumeMatch()) navigate('/intro/dice', true);
  }, []);
  if (d.phase === 'results' && d.results) return <DiceResults results={d.results} />;
  if (!d.match) return null;
  if (d.phase === 'pass') return <PassScreen d={d} />;
  return <DiceTurn key={d.turn.id} d={d} />;
}
