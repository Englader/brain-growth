/**
 * Grown-ups dashboard: local-only instrument for the adult. Mastery over time,
 * engine calibration, recurring misconceptions, session trends, backups,
 * feature flags per child, and a speech-voice report for this device.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { deleteProfile, exportBackup, importBackup, rebuildFromLog, recentLog, setFlag, updateProfile } from '../app/actions';
import { navigate } from '../app/router';
import { now, repo, speaker } from '../app/services';
import { useStore } from '../app/store';
import { RECORDED_CLIPS } from '../audio/clips';
import { requiredClips } from '../audio/voiceScript';
import { glickoElo } from '../core/engine/glicko';
import { FLAGS, flagLabelKey, isEnabled, type FlagDef } from '../core/flags';
import { defaultBandForAge, type Profile } from '../core/profile';
import { GRAPH } from '../core/skills';
import { BAND_IDS, type BandId } from '../core/types';
import { allLocales, getLocale } from '../i18n/locales';
import { numberText } from '../i18n/render';
import { TopBar } from '../ui/components/common';
import { Icon } from '../ui/components/Icon';
import { useT } from '../ui/hooks';
import { StorageDetails, StorageWarning } from '../ui/storage/StorageDetails';
import { calibration, misconceptions, overview, skillRows, strategyA, unusualErrors } from './analytics';
import { BarChart, Reliability, StepLines } from './charts';
import { MissingClips, PilotReadout, StrategyStat } from './Pilot';

type Tab = 'overview' | 'skills' | 'calibration' | 'errors' | 'data' | 'features' | 'voices' | 'profile';
const TABS: Tab[] = ['overview', 'skills', 'calibration', 'errors', 'data', 'features', 'voices', 'profile'];

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Adult(): JSX.Element {
  const t = useT();
  const profiles = useStore((s) => s.profiles);
  const active = useStore((s) => s.profile);
  const [pid, setPid] = useState<string | null>(active?.id ?? profiles[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>('overview');
  const p = profiles.find((x) => x.id === pid) ?? null;
  return (
    <div class="screen adult" data-theme-adult>
      <TopBar title={t('adult.title')} onBack={() => navigate('/')} />
      <div class="adult-controls">
        {profiles.length > 0 && (
          <label class="field inline">
            <span>{t('adult.player')}</span>
            <select value={pid ?? ''} onChange={(e) => setPid((e.currentTarget as HTMLSelectElement).value)}>
              {profiles.map((x) => (
                <option value={x.id}>{x.name}</option>
              ))}
            </select>
          </label>
        )}
        <nav class="tabs" role="tablist">
          {TABS.map((id) => (
            <button type="button" role="tab" aria-selected={tab === id} class={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {t(`adult.tab.${id}` as 'adult.tab.overview')}
            </button>
          ))}
        </nav>
      </div>
      <div class="adult-body">
        {tab === 'data' ? <DataTab /> : tab === 'voices' ? <VoicesTab /> : !p ? <p class="muted">{t('adult.overview.noData')}</p> : null}
        {p && tab === 'overview' && <OverviewTab p={p} />}
        {p && tab === 'skills' && p.band === 'A' && <p class="muted">{t('pilot.strategy.help')}</p>}
        {p && tab === 'skills' && <SkillsTab p={p} />}
        {p && tab === 'calibration' && <CalibrationTab p={p} />}
        {p && tab === 'errors' && <ErrorsTab p={p} />}
        {tab === 'features' && <FeaturesTab p={p} />}
        {p && tab === 'profile' && <ProfileTab p={p} onDeleted={() => setPid(null)} />}
      </div>
    </div>
  );
}

const pct = (v: number | null, locale: string): string => (v === null ? '—' : `${numberText(Math.round(v * 100), locale)}%`);

function Tile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div class="tile">
      <div class="tile-label">{label}</div>
      <div class="tile-value">{value}</div>
    </div>
  );
}

function OverviewTab({ p }: { p: Profile }): JSX.Element {
  const t = useT();
  const o = useMemo(() => overview(p, recentLog(p.id), now()), [p]);
  const fmtDay = (d: string): string => new Intl.DateTimeFormat(getLocale(t.locale).bcp47, { day: 'numeric', month: 'numeric' }).format(new Date(`${d}T12:00:00`));
  return (
    <div class="stack">
      <div class="tiles">
        <Tile label={t('adult.overview.items')} value={numberText(o.items30, t.locale)} />
        <Tile label={t('adult.overview.accuracy')} value={pct(o.accuracy30, t.locale)} />
        <Tile label={t('adult.overview.medianSession')} value={o.medianSessionMin === null ? '—' : t('adult.overview.minutes', { n: Math.round(o.medianSessionMin * 10) / 10 })} />
        <Tile label={t('adult.overview.streak')} value={t('streak.days', { n: o.streak })} />
      </div>
      <p class="muted">
        {p.placement.done && p.placement.g !== undefined
          ? t('adult.overview.placement', { grade: t('grade.label', { g: String(Math.floor(p.placement.g)) }), sd: Math.round((p.placement.sd ?? 0) * 10) / 10 })
          : t('adult.overview.placementPending')}
      </p>
      <section class="card">
        <h2>{t('adult.overview.sessions')}</h2>
        <BarChart
          data={o.minutesByDay.map((d) => ({ label: fmtDay(d.day), value: d.minutes }))}
          format={(v) => numberText(Math.round(v * 10) / 10, t.locale, 1)}
          ariaLabel={t('adult.overview.sessions')}
          tickLabel={(l, i) => (i % 7 === 1 ? l : null)}
        />
      </section>
      <section class="card">
        <h2>{t('adult.overview.mastery')}</h2>
        <StepLines
          ariaLabel={t('adult.overview.mastery')}
          labels={o.skillsByDay.map((d) => fmtDay(d.day))}
          series={[
            { name: t('adult.overview.proficientSeries'), cls: 'series-1', values: o.skillsByDay.map((d) => d.proficient) },
            { name: t('adult.overview.masteredSeries'), cls: 'series-2', values: o.skillsByDay.map((d) => d.mastered) },
          ]}
        />
      </section>
      <section class="card">
        <p>{o.freeChoice === null ? t('adult.overview.freeChoiceNone') : t('adult.overview.freeChoice', { pct: Math.round(o.freeChoice * 100) })}</p>
        <p class="muted">{t('adult.overview.freeChoiceHelp')}</p>
      </section>
      <PilotReadout p={p} />
    </div>
  );
}

function SkillsTab({ p }: { p: Profile }): JSX.Element {
  const t = useT();
  const rows = useMemo(() => skillRows(p, recentLog(p.id), now(), glickoElo, GRAPH), [p]);
  // Band A: counting (hop buttons) vs direct taps per skill (pilot, DESIGN §5.2).
  const strategy = useMemo(() => (p.band === 'A' ? new Map(strategyA(recentLog(p.id)).map((s) => [s.skill, s])) : null), [p]);
  const n1 = (v: number): string => numberText(Math.round(v * 10) / 10, t.locale, 1);
  // Cards rather than a 9-column table: this view is used on phones too.
  return (
    <ul class="skill-cards">
      {rows.map((r) => (
        <li class="skill-card">
          <header>
            <strong>{t.dyn(`skill.${r.id}`)}</strong>
            <span class={`status-chip ${r.status}`}>{t(`adult.status.${r.status}` as 'adult.status.locked')}</span>
          </header>
          <dl class="skill-stats">
            <div>
              <dt>{t('adult.skills.mastery')}</dt>
              <dd>{pct(r.mastery, t.locale)}</dd>
            </div>
            <div>
              <dt>{t('adult.skills.rating')}</dt>
              <dd>
                {n1(r.mu)} ± {n1(r.sd)}
              </dd>
            </div>
            <div>
              <dt>{t('adult.skills.n')}</dt>
              <dd>{r.n}</dd>
            </div>
            <div>
              <dt>{t('adult.skills.recall')}</dt>
              <dd>
                {r.recall === null ? '—' : pct(r.recall, t.locale)}
                {r.dueDays !== null && <small class="muted"> · {r.dueDays <= 0 ? t('adult.skills.dueNow') : t('adult.skills.dueIn', { d: n1(r.dueDays) })}</small>}
              </dd>
            </div>
            <div>
              <dt>{t('adult.skills.recent')}</dt>
              <dd>{r.recent.n ? `${r.recent.correct}/${r.recent.n}` : '—'}</dd>
            </div>
            <div>
              <dt>{t('adult.skills.latency')}</dt>
              <dd>{r.medianLatency === null ? '—' : t('sprint.seconds', { s: n1(r.medianLatency / 1000) })}</dd>
            </div>
            <div>
              <dt>{t('adult.skills.bias')}</dt>
              <dd class={r.bias !== null && Math.abs(r.bias) > 0.15 ? 'flag' : ''}>{r.bias === null ? '—' : `${r.bias > 0 ? '+' : ''}${pct(r.bias, t.locale)}`}</dd>
            </div>
            {strategy && <StrategyStat row={strategy.get(r.id)} />}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function CalibrationTab({ p }: { p: Profile }): JSX.Element {
  const t = useT();
  const c = useMemo(() => calibration(recentLog(p.id)), [p]);
  return (
    <div class="stack">
      <section class="card">
        <h2>{t('adult.calibration.title')}</h2>
        {c.bins.length ? (
          <>
            <Reliability
              bins={c.bins}
              labels={{ predicted: t('adult.calibration.predicted'), observed: t('adult.calibration.observed') }}
              ariaLabel={t('adult.calibration.title')}
              pct={(v) => pct(v, t.locale)}
            />
            <table class="data compact">
              <thead>
                <tr>
                  <th>{t('adult.calibration.predicted')}</th>
                  <th>{t('adult.calibration.observed')}</th>
                  <th>{t('adult.calibration.n')}</th>
                </tr>
              </thead>
              <tbody>
                {c.bins.map((b) => (
                  <tr>
                    <td class="num">{pct(b.meanP, t.locale)}</td>
                    <td class="num">{pct(b.observed, t.locale)}</td>
                    <td class="num">{b.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p class="muted">{t('adult.overview.noData')}</p>
        )}
        <p class="muted">{t('adult.calibration.help')}</p>
      </section>
      <section class="card">
        <h2>{t('adult.calibration.flagged')}</h2>
        {c.flagged.length ? (
          <ul class="plain">
            {c.flagged.map((f) => (
              <li>{t('adult.calibration.biasRow', { skill: t.dyn(`skill.${f.skill}`), p: Math.round(f.p * 100), o: Math.round(f.o * 100), n: f.n })}</li>
            ))}
          </ul>
        ) : (
          <p class="muted">{t('adult.calibration.none')}</p>
        )}
      </section>
    </div>
  );
}

function ErrorsTab({ p }: { p: Profile }): JSX.Element {
  const t = useT();
  const log = recentLog(p.id);
  const mis = useMemo(() => misconceptions(log), [p]);
  const unusual = useMemo(() => unusualErrors(log), [p]);
  const max = Math.max(1, ...mis.map((m) => m.n));
  return (
    <div class="stack">
      <section class="card">
        <h2>{t('adult.errors.title')}</h2>
        {mis.length ? (
          <ul class="hbars">
            {mis.map((m) => (
              <li>
                <span class="hbar-label">{t.dyn(`mis.${m.code}.name`)}</span>
                <span class="hbar-track">
                  <span class="hbar" style={{ width: `${(m.n / max) * 100}%` }} />
                </span>
                <span class="hbar-value">{t('adult.errors.count', { n: m.n })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">{t('adult.errors.none')}</p>
        )}
      </section>
      <section class="card">
        <h2>{t('adult.errors.unusual')}</h2>
        {unusual.length ? (
          <ul class="plain">
            {unusual.map((u) => (
              <li>
                <strong>{t.dyn(`skill.${u.skill}`)}</strong>: {t('adult.errors.expected', { e: Math.round(u.expected * 100), o: Math.round(u.observed * 100) })}
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">{t('adult.errors.noneUnusual')}</p>
        )}
      </section>
    </div>
  );
}

function DataTab(): JSX.Element {
  const t = useT();
  const meta = useStore((s) => s.meta);
  const readOnly = useStore((s) => s.readOnly);
  const otherTab = useStore((s) => s.otherTab);
  const full = useStore((s) => s.storageFull);
  const [msg, setMsg] = useState<string | null>(null);
  const usage = repo.usage();
  const onExport = (): void => {
    const { name, text } = exportBackup();
    download(name, text);
  };
  const onShare = async (): Promise<void> => {
    const { name, text } = exportBackup();
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name }).catch(() => undefined);
    else download(name, text);
  };
  const onImport = async (e: Event): Promise<void> => {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    const r = importBackup(await f.text());
    setMsg(r.ok ? t('adult.data.importOk', { added: r.profilesAdded.length, merged: r.profilesMerged.length, records: r.recordsAdded }) : t('adult.data.importFail', { reason: r.error ?? '?' }));
  };
  const last = meta?.lastBackupAt ? new Intl.DateTimeFormat(getLocale(t.locale).bcp47, { dateStyle: 'medium' }).format(meta.lastBackupAt) : t('adult.data.never');
  return (
    <div class="stack">
      {readOnly && !otherTab && <p class="warn">{t('adult.data.readOnly')}</p>}
      {full && <p class="warn">{t('adult.data.full')}</p>}
      <StorageWarning />
      <section class="card">
        <p>{t('adult.data.lastBackup', { date: last })}</p>
        <div class="row wrap">
          <button type="button" class="btn primary" onClick={onExport}>
            <Icon name="download" /> {t('adult.data.export')}
          </button>
          <button type="button" class="btn" onClick={() => void onShare()}>
            <Icon name="share" /> {t('adult.data.share')}
          </button>
          <label class="btn">
            <Icon name="upload" /> {t('adult.data.import')}
            <input type="file" accept="application/json,.json" class="visually-hidden" onChange={(e) => void onImport(e)} />
          </label>
        </div>
        {msg && <p role="status">{msg}</p>}
        <p class="muted">{t('adult.data.iosNote')}</p>
      </section>
      <section class="card storage-card">
        <p>{t('adult.data.storage', { kb: Math.round(usage.bytes / 1024) })}</p>
        <StorageDetails idbBytes={usage.idbBytes} />
        <p class="muted">{t('adult.data.rivals', { n: Object.keys(repo.rivals()).length })}</p>
      </section>
    </div>
  );
}

function FeaturesTab({ p }: { p: Profile | null }): JSX.Element {
  const t = useT();
  const meta = useStore((s) => s.meta);
  const row = (f: FlagDef, on: boolean, change: (v: boolean) => void): JSX.Element => (
    <label class="switch-row">
      <input type="checkbox" checked={on} onChange={(e) => change((e.currentTarget as HTMLInputElement).checked)} />
      <span>
        <code>{f.id}</code> — {t.dyn(flagLabelKey(f))}
      </span>
    </label>
  );
  return (
    <div class="stack">
      <h2>{t('adult.features.title')}</h2>
      {p && (
        <section class="card">
          <h3>{t('adult.features.profile', { name: p.name })}</h3>
          {FLAGS.filter((f) => f.scope === 'profile').map((f) => row(f, isEnabled(f.id, p.flags, meta?.deviceFlags), (v) => setFlag('profile', f.id, v, p.id)))}
        </section>
      )}
      <section class="card">
        <h3>{t('adult.features.device')}</h3>
        {FLAGS.filter((f) => f.scope === 'device').map((f) => row(f, isEnabled(f.id, undefined, meta?.deviceFlags), (v) => setFlag('device', f.id, v)))}
      </section>
    </div>
  );
}

function VoicesTab(): JSX.Element {
  const t = useT();
  const [, force] = useState(0);
  // Voices load asynchronously in some browsers.
  useEffect(() => {
    const s = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!s) return;
    const on = (): void => force((x) => x + 1);
    s.addEventListener?.('voiceschanged', on);
    return () => s.removeEventListener?.('voiceschanged', on);
  }, []);
  const report = speaker.report();
  return (
    <div class="stack">
      <h2>{t('adult.voices.title')}</h2>
      {report.map((r) => {
        const loc = getLocale(r.locale);
        const clips = RECORDED_CLIPS[r.locale]?.length ?? 0;
        return (
          <section class="card">
            <p>
              {r.voices.length
                ? t('adult.voices.found', { lang: loc.nativeName, voices: r.voices.map((v) => `${v.name} (${v.lang})`).join(', ') })
                : t('adult.voices.none', { lang: loc.nativeName })}
            </p>
            <p class="muted">{t('adult.voices.clips', { lang: loc.nativeName, n: `${clips}/${requiredClips(r.locale).length}` })}</p>
            <button type="button" class="btn small" onClick={() => speaker.say('voice.welcome', {}, r.locale)}>
              <Icon name="speaker" /> {t('adult.voices.test')}
            </button>
            <MissingClips locale={r.locale} />
          </section>
        );
      })}
      <p class="muted">{t('adult.voices.help')}</p>
    </div>
  );
}

function ProfileTab({ p, onDeleted }: { p: Profile; onDeleted: () => void }): JSX.Element {
  const t = useT();
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div class="stack">
      <label class="field">
        <span>{t('adult.profile.age')}</span>
        <select
          value={String(p.age)}
          onChange={(e) => {
            const age = Number((e.currentTarget as HTMLSelectElement).value);
            updateProfile(p.id, p.bandOverridden ? { age } : { age, band: defaultBandForAge(age) });
          }}
        >
          {Array.from({ length: 10 }, (_, i) => i + 5).map((a) => (
            <option value={String(a)}>{numberText(a, t.locale)}</option>
          ))}
        </select>
      </label>
      <label class="field">
        <span>{t('adult.profile.band')}</span>
        <select
          value={p.bandOverridden ? p.band : 'auto'}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            if (v === 'auto') updateProfile(p.id, { band: defaultBandForAge(p.age), bandOverridden: false });
            else updateProfile(p.id, { band: v as BandId, bandOverridden: true });
          }}
        >
          <option value="auto">{t('adult.profile.bandAuto')}</option>
          {BAND_IDS.map((b) => (
            <option value={b}>{t(`create.band${b}` as 'create.bandA')}</option>
          ))}
        </select>
      </label>
      <label class="field">
        <span>{t('create.language')}</span>
        <select value={p.locale} onChange={(e) => updateProfile(p.id, { locale: (e.currentTarget as HTMLSelectElement).value })}>
          {allLocales().map((l) => (
            <option value={l.id}>{l.nativeName}</option>
          ))}
        </select>
      </label>
      <button type="button" class="btn" onClick={() => setMsg(t('adult.profile.replayed', { n: rebuildFromLog(p.id) }))}>
        {t('adult.profile.replay')}
      </button>
      {msg && <p role="status">{msg}</p>}
      <section class="card danger">
        <p>{t('adult.profile.deleteConfirm', { name: p.name })}</p>
        <input type="text" value={confirm} onInput={(e) => setConfirm((e.currentTarget as HTMLInputElement).value)} aria-label={t('adult.profile.delete')} />
        <button
          type="button"
          class="btn danger"
          disabled={confirm.trim() !== p.name}
          onClick={() => {
            deleteProfile(p.id);
            onDeleted();
          }}
        >
          {t('adult.profile.delete')}
        </button>
      </section>
    </div>
  );
}
