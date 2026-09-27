/**
 * Home, forked by band. Same data and actions; three presentations:
 *  A (5–7): icon-only, huge targets, spoken greeting, the frog front and centre.
 *  B (8–11): pet, streak, daily quest, modes, collection.
 *  C (12–14): dark dashboard of stats, mastery by topic, objectives.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { evalCtx, launchMode, petTap, signOut, toast } from '../../app/actions';
import { navigate } from '../../app/router';
import { now, speaker } from '../../app/services';
import { useStore } from '../../app/store';
import { play as sfx, unlockAudio } from '../../audio/sfx';
import { glickoElo } from '../../core/engine/glicko';
import { isDue } from '../../core/engine/memory';
import { wildcardForWeek } from '../../core/league';
import type { Profile } from '../../core/profile';
import { questProgress } from '../../core/quests';
import { GRAPH } from '../../core/skills';
import { streakView } from '../../core/streaks';
import { dayKey, weekKey } from '../../core/time';
import type { BandId, Strand } from '../../core/types';
import { isReady, modesFor } from '../../modes/registry';
import type { ModeDef } from '../../modes/types';
import { HomeWidgets } from '../homeWidgets';
import { LangToggle } from '../components/common';
import { Frog } from '../components/Frog';
import { Icon } from '../components/Icon';
import { lookFor, useT } from '../hooks';
import { Avatar } from './Profiles';

function launch(mode: ModeDef, stretch = false, quick = false): void {
  unlockAudio();
  launchMode(mode, { ...(stretch ? { stretch: true } : {}), ...(quick ? { quick: true } : {}) });
}

function unseen(p: Profile): number {
  return Object.values(p.achievements).filter((a) => !a.seen).length;
}

function StreakStones({ p }: { p: Profile }): JSX.Element {
  const t = useT();
  const v = streakView(p.streak, dayKey(now()));
  if (v.establishing) {
    const lit = Math.min(7, v.current);
    return (
      <div class="stones" role="img" aria-label={t('streak.establish', { n: Math.max(1, v.current + (v.doneToday ? 0 : 1)) })}>
        {Array.from({ length: 7 }, (_, i) => (
          <span class={`stone${i < lit ? ' lit' : ''}${i === lit && !v.doneToday ? ' next' : ''}`}>
            {i < lit ? <Icon name="flame" size={18} solid /> : null}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div class="streak-chip" aria-label={t('streak.days', { n: v.current })}>
      <Icon name="flame" solid /> {t('streak.days', { n: v.current })}
    </div>
  );
}

function StreakLine({ p }: { p: Profile }): JSX.Element {
  const t = useT();
  const v = streakView(p.streak, dayKey(now()));
  const yesterday = v.calendar[v.calendar.length - 2];
  return (
    <div class="streak-line">
      <StreakStones p={p} />
      <p class="muted">
        {v.doneToday ? t('streak.doneToday') : yesterday?.mark === 'frozen' ? t('streak.frozen') : v.current === 0 && v.longest > 0 ? t('streak.fresh') : t('streak.notYet')}
      </p>
    </div>
  );
}

function QuestCard({ p }: { p: Profile }): JSX.Element | null {
  const t = useT();
  if (!p.quests || p.quests.day !== dayKey(now()) || !(p.flags['quests.daily'] ?? true)) return null;
  const ctx = evalCtx(p, null);
  const all = p.quests.ids.length > 0 && p.quests.ids.every((id) => questProgress(id, ctx).done);
  return (
    <section class="card quests">
      <h2>{t('quests.title')}</h2>
      <ul>
        {p.quests.ids.map((id) => {
          const q = questProgress(id, ctx);
          return (
            <li class={q.done ? 'done' : ''}>
              <span class="check">{q.done ? <Icon name="check" size={18} /> : null}</span>
              <span class="q-text">{t.dyn(id, { target: q.target })}</span>
              {q.target > 1 && !q.done && (
                <span class="q-prog">
                  {q.value}/{q.target}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {all && <p class="note">{t('quests.allDone')}</p>}
    </section>
  );
}

function NavRow({ p, band }: { p: Profile; band: BandId }): JSX.Element {
  const t = useT();
  const meta = useStore((s) => s.meta);
  const league = meta?.deviceFlags['league.family'] ?? true;
  const items: Array<{ icon: Parameters<typeof Icon>[0]['name']; label: string; go: () => void; badge?: number }> = [
    { icon: 'trophy', label: t('home.trophies'), go: () => navigate('/trophies'), badge: unseen(p) },
    { icon: band === 'C' ? 'sun' : 'hanger', label: t('home.wardrobe'), go: () => navigate('/wardrobe'), badge: p.rewards.pending.length },
    ...(league && band !== 'A' ? [{ icon: 'people' as const, label: t('home.family'), go: () => navigate('/family') }] : []),
    { icon: band === 'A' ? 'user' : 'gear', label: band === 'A' ? t('home.switch') : t('home.settings'), go: () => (band === 'A' ? signOut() : navigate('/settings')) },
  ];
  return (
    <nav class="nav-row">
      {items.map((it) => (
        <button type="button" class="nav-btn" aria-label={it.label} onClick={it.go}>
          <span class="nav-icon">
            <Icon name={it.icon} size={band === 'A' ? 34 : 26} />
            {!!it.badge && <span class="dot-badge">{it.badge}</span>}
          </span>
          <span class="nav-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

function useModes(p: Profile): ModeDef[] {
  const meta = useStore((s) => s.meta);
  return modesFor(p, meta?.deviceFlags ?? {});
}

// ── Band A ────────────────────────────────────────────────────────────────
function HomeA({ p }: { p: Profile }): JSX.Element {
  const t = useT();
  const look = lookFor(p);
  const [bounce, setBounce] = useState(false);
  const modes = useModes(p);
  const hop = modes.find((m) => m.id === 'hop')!;
  // Other modes offered to pre-readers: big icon tiles, only once they can be started (no locked states in A).
  const tray = modes.filter((m) => m.homeA && m.id !== 'hop' && isReady(m, p));
  useEffect(() => {
    if (p.settings.voice) speaker.say('voice.welcome', {}, p.locale);
  }, [p.locale]);
  const tapFrog = (): void => {
    unlockAudio();
    sfx('hop');
    setBounce(true);
    window.setTimeout(() => setBounce(false), 450);
    const ids = petTap();
    if (ids.length) toast(t.dyn(`ach.${ids[0]}.name`));
  };
  return (
    <div class="screen home home-a">
      <header class="topbar">
        <button type="button" class="icon-btn big" aria-label={t('common.speaker')} onClick={() => speaker.say('voice.welcome', {}, p.locale)}>
          <Icon name="speaker" size={30} />
        </button>
        <span class="grow" />
        <LangToggle />
      </header>
      <div class={`pet-stage${bounce ? ' bounce' : ''}`}>
        <Frog color={look.color} hat={look.hat} size={170} mood="happy" onClick={tapFrog} label={p.settings.petName ?? t('settings.petDefault')} />
      </div>
      <StreakStones p={p} />
      <button type="button" class="btn go huge" aria-label={t('common.play')} onClick={() => launch(hop)}>
        <Icon name="play" size={64} solid />
      </button>
      <button type="button" class="btn quick" aria-label={t('home.quick')} onClick={() => launch(hop, false, true)}>
        <Icon name="bolt" size={34} solid />
      </button>
      {tray.length > 0 && (
        <div class="mode-tray">
          {tray.map((m) => (
            <button type="button" class={`btn mode-tile mode-${m.id}`} aria-label={t(m.titleKey)} onClick={() => launch(m)}>
              <Icon name={m.icon} size={40} />
            </button>
          ))}
        </div>
      )}
      <HomeWidgets p={p} />
      <NavRow p={p} band="A" />
    </div>
  );
}

// ── Band B ────────────────────────────────────────────────────────────────
function ModeCard({ p, mode, stretch, setStretch }: { p: Profile; mode: ModeDef; stretch: boolean; setStretch: (v: boolean) => void }): JSX.Element {
  const t = useT();
  const ready = isReady(mode, p);
  return (
    <section class={`card mode-card mode-${mode.id}`}>
      <div class="mode-head">
        <span class="mode-icon">
          <Icon name={mode.icon} size={28} />
        </span>
        <div>
          <h2>{t(mode.titleKey)}</h2>
          <p class="muted">{ready ? t(mode.descKey) : t(mode.notReadyKey ?? mode.descKey)}</p>
        </div>
      </div>
      {mode.id === 'hop' && (
        <>
          <button type="button" class="btn primary big" onClick={() => launch(mode, stretch)}>
            <Icon name="play" solid /> {t('common.play')}
          </button>
          <div class="row wrap">
            <button type="button" class={`chip${stretch ? ' on' : ''}`} aria-pressed={stretch} onClick={() => setStretch(!stretch)}>
              <Icon name="mountain" size={18} /> {stretch ? t('home.stretchOn') : t('home.stretch')}
            </button>
            <button type="button" class="chip" onClick={() => launch(mode, false, true)}>
              <Icon name="bolt" size={18} /> {t('home.quick')}
            </button>
          </div>
        </>
      )}
      {mode.id !== 'hop' && (
        <button type="button" class="btn" disabled={!ready} onClick={() => launch(mode)}>
          <Icon name={mode.icon} /> {t(mode.titleKey)}
        </button>
      )}
    </section>
  );
}

function HomeB({ p }: { p: Profile }): JSX.Element {
  const t = useT();
  const look = lookFor(p);
  const modes = useModes(p);
  const [stretch, setStretch] = useState(false);
  const [says] = useState(() => 1 + Math.floor(Math.random() * 3));
  const due = Object.values(p.skills).filter((s) => isDue(s, now())).length;
  return (
    <div class="screen home home-b">
      <header class="topbar">
        <h1 class="greeting">{t('home.greeting', { name: p.name })}</h1>
        <LangToggle />
      </header>
      <section class="pet-row">
        <Frog
          color={look.color}
          hat={look.hat}
          size={96}
          mood="happy"
          onClick={() => {
            sfx('hop');
            const ids = petTap();
            if (ids.length) toast(t.dyn(`ach.${ids[0]}.name`));
          }}
          label={p.settings.petName ?? t('settings.petDefault')}
        />
        <div class="bubble">{p.placement.done ? t(`home.petSays${says}` as 'home.petSays1') : t('home.firstTime')}</div>
      </section>
      <StreakLine p={p} />
      {modes.map((m) => (
        <ModeCard p={p} mode={m} stretch={stretch} setStretch={setStretch} />
      ))}
      {due > 0 && <p class="muted center">{t('home.reviewDue', { n: due })}</p>}
      <HomeWidgets p={p} />
      <QuestCard p={p} />
      <NavRow p={p} band="B" />
    </div>
  );
}

// ── Band C ────────────────────────────────────────────────────────────────
function HomeC({ p }: { p: Profile }): JSX.Element {
  const t = useT();
  const modes = useModes(p);
  const [stretch, setStretch] = useState(false);
  const t0 = now();
  const states = Object.values(p.skills);
  const mastered = states.filter((s) => s.masteredAt !== undefined).length;
  const solid = states.filter((s) => s.proficientAt !== undefined).length;
  const v = streakView(p.streak, dayKey(t0));
  const strands = new Map<Strand, { sum: number; n: number }>();
  for (const s of GRAPH.playableSkills()) {
    const st = p.skills[s.id];
    const e = strands.get(s.strand) ?? { sum: 0, n: 0 };
    e.sum += st ? glickoElo.masteryP(st, s, t0) : 0;
    e.n++;
    strands.set(s.strand, e);
  }
  const title = p.cosmetics.equipped.title;
  const wild = wildcardForWeek(weekKey(t0));
  return (
    <div class="screen home home-c">
      <header class="topbar">
        <Avatar p={p} size={40} />
        <div class="who">
          <h1 class="greeting">{t('home.greeting', { name: p.name })}</h1>
          {title && <span class="muted">{t.dyn(`cos.${title}`)}</span>}
        </div>
        <LangToggle />
      </header>
      {!p.placement.done && <p class="muted">{t('home.firstTime')}</p>}
      <div class="tiles">
        <div class="tile">
          <div class="tile-label">{t('home.mastered')}</div>
          <div class="tile-value">{mastered}</div>
        </div>
        <div class="tile">
          <div class="tile-label">{t('home.proficient')}</div>
          <div class="tile-value">{solid}</div>
        </div>
        <div class="tile">
          <div class="tile-label">{t('home.streak')}</div>
          <div class="tile-value">{v.current}</div>
          <div class="tile-sub muted">{v.doneToday ? t('streak.doneToday') : t('streak.notYet')}</div>
        </div>
      </div>
      {modes.map((m) => (
        <ModeCard p={p} mode={m} stretch={stretch} setStretch={setStretch} />
      ))}
      <section class="card">
        <h2>{t('home.byStrand')}</h2>
        <ul class="meters">
          {[...strands.entries()].map(([strand, e]) => {
            const pct = Math.round((e.sum / e.n) * 100);
            return (
              <li>
                <span class="meter-label">{t.dyn(`strand.${strand}`)}</span>
                <span class="meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <span class="meter-fill" style={{ width: `${pct}%` }} />
                </span>
                <span class="meter-value">{pct}%</span>
              </li>
            );
          })}
        </ul>
      </section>
      <HomeWidgets p={p} />
      <QuestCard p={p} />
      <p class="muted center">
        {t('family.wildcard')}: {t.dyn(`family.wild.${wild}`)}
      </p>
      <NavRow p={p} band="C" />
    </div>
  );
}

export function Home(): JSX.Element | null {
  const p = useStore((s) => s.profile);
  if (!p) return null;
  return p.band === 'A' ? <HomeA p={p} /> : p.band === 'B' ? <HomeB p={p} /> : <HomeC p={p} />;
}
