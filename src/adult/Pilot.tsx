/**
 * Pilot support in the grown-ups dashboard (DESIGN §4 steps 1–2, §5.2 I-1):
 * the "Pilot readout" card on Overview, the Band A strategy stat on Skills,
 * and the recording checklist (missing clips) on Voices.
 */
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { recentLog } from '../app/actions';
import { now } from '../app/services';
import { clipFile, clipText, missingClips } from '../audio/clips';
import type { Profile } from '../core/profile';
import type { LocaleId } from '../core/types';
import { getLocale } from '../i18n/locales';
import { numberText, percentText } from '../i18n/render';
import { Icon } from '../ui/components/Icon';
import { useT } from '../ui/hooks';
import { calibrationBias, exitsAfterError, feedbackTime, hintUsage, misconceptions, overview, type StrategyRow } from './analytics';
import './pilot.css';

const pct = (v: number | null, locale: LocaleId): string => (v === null ? '—' : percentText(Math.round(v * 100), locale));
const tenths = (v: number): number => Math.round(v * 10) / 10;

function Tile({ label, value, sub }: { label: string; value: string; sub: string }): JSX.Element {
  return (
    <div class="tile">
      <div class="tile-label">{label}</div>
      <div class="tile-value">{value}</div>
      <div class="tile-sub">{sub}</div>
    </div>
  );
}

/** Overview card: the measures the two-week pilot reads (DESIGN §4 step 2, §5.2). */
export function PilotReadout({ p }: { p: Profile }): JSX.Element {
  const t = useT();
  const r = useMemo(() => {
    const log = recentLog(p.id);
    return {
      o: overview(p, log, now()),
      exits: exitsAfterError(log),
      hints: hintUsage(log),
      feedback: feedbackTime(log),
      bias: calibrationBias(log),
      mis: misconceptions(log).slice(0, 3),
    };
  }, [p]);
  const { o, exits, hints, feedback, bias, mis } = r;
  const max = Math.max(1, ...mis.map((m) => m.n));
  return (
    <section class="card pilot-card">
      <h2>{t('pilot.title')}</h2>
      <p class="muted">{t('pilot.help')}</p>
      <div class="tiles">
        <Tile
          label={t('adult.overview.medianSession')}
          value={o.medianSessionMin === null ? '—' : t('adult.overview.minutes', { n: tenths(o.medianSessionMin) })}
          sub={t('pilot.session')}
        />
        <Tile
          label={t('pilot.exits')}
          value={pct(exits.share, t.locale)}
          sub={exits.exits ? t('pilot.exitsOf', { n: exits.afterError, total: exits.exits }) : t('pilot.exitsNone')}
        />
        <Tile label={t('pilot.hints')} value={pct(hints.share, t.locale)} sub={hints.n ? t('pilot.hintsOf', { n: hints.used, total: hints.n }) : t('pilot.hintsNone')} />
        <Tile
          label={t('pilot.feedback')}
          value={feedback.medianMs === null ? '—' : t('sprint.seconds', { s: tenths(feedback.medianMs / 1000) })}
          sub={feedback.n ? t('pilot.feedbackOf', { n: feedback.n }) : t('pilot.feedbackNone')}
        />
        <Tile label={t('pilot.freeChoice')} value={pct(o.freeChoice, t.locale)} sub={o.freeChoice === null ? t('pilot.freeChoiceNone') : t('pilot.freeChoiceOf')} />
      </div>
      <h3>{t('pilot.calTitle')}</h3>
      {bias.length ? (
        <ul class="plain">
          {bias.map((b) => (
            <li>{t('adult.calibration.biasRow', { skill: t.dyn(`skill.${b.skill}`), p: Math.round(b.p * 100), o: Math.round(b.o * 100), n: b.n })}</li>
          ))}
        </ul>
      ) : (
        <p class="muted">{t('pilot.calNone')}</p>
      )}
      <h3>{t('pilot.misTitle')}</h3>
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
  );
}

/** Skills tab, Band A: hop buttons vs direct taps on this skill, and how answer time moved (counting → retrieval). */
export function StrategyStat({ row }: { row: StrategyRow | undefined }): JSX.Element {
  const t = useT();
  const sec = (ms: number): string => t('sprint.seconds', { s: tenths(ms / 1000) });
  const hops = row ? Math.round(row.hopShare * 100) : 0;
  const { early, late } = row?.latency ?? { early: null, late: null };
  return (
    <div class="pilot-strategy">
      <dt>{t('pilot.strategy.title')}</dt>
      <dd>
        {row ? t('pilot.strategy.split', { hops, taps: 100 - hops }) : '—'}
        {row && (row.stage || (early !== null && late !== null)) && (
          <small class="muted">
            {row.stage && t(`pilot.strategy.${row.stage}` as 'pilot.strategy.counting')}
            {row.stage && early !== null && late !== null && ' · '}
            {early !== null && late !== null && (
              <span class="nowrap">
                {sec(early)} <Icon name="arrowR" size={12} /> {sec(late)}
              </span>
            )}
          </small>
        )}
      </dd>
    </div>
  );
}

/** Voices tab: the clips a locale still needs, as a collapsible recording checklist. */
export function MissingClips({ locale }: { locale: LocaleId }): JSX.Element {
  const t = useT();
  const missing = missingClips(locale);
  if (!missing.length) return <p class="muted">{t('pilot.clips.done')}</p>;
  return (
    <details class="pilot-clips">
      <summary>{t('pilot.clips.missing', { n: missing.length })}</summary>
      <p class="muted">{t('pilot.clips.how', { dir: `public/audio/${locale}/` })}</p>
      <ol class="pilot-cliplist">
        {missing.map((id) => (
          <li>
            <code>{clipFile(id)}</code> <span lang={getLocale(locale).bcp47}>{clipText(locale, id)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
