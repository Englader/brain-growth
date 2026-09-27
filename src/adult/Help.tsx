/**
 * Grown-ups → Help: where a child needed help. First tries split into no
 * help, a hint (by ladder level) and "show me", for a period; the weekly
 * share with help; the skills, puzzles and games where help was used most;
 * and the recent questions answered with help, rebuilt from the log in the
 * grown-up's language. Parents only (the adult view sits behind the parent PIN
 * gate): children never see these numbers, and nothing here judges.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { wholeLog } from '../app/helpActions';
import { now } from '../app/services';
import { loadAllGenerators } from '../core/items/generators';
import { HELP_KINDS, type Help } from '../core/log/help';
import type { Profile } from '../core/profile';
import type { LocaleId } from '../core/types';
import { formatDate } from '../i18n/dates';
import { tk } from '../i18n/i18n';
import { getLocale } from '../i18n/locales';
import { numberText, percentText } from '../i18n/render';
import { getMode } from '../modes/registry';
import { Icon } from '../ui/components/Icon';
import { useT } from '../ui/hooks';
import { BarChart, StackedBar } from './charts';
import { describeRecord } from './helpItems';
import { helpBy, helpByWeek, helpedCount, helpSummary, recentHelp, type HelpAnswer, type HelpGroup, type HelpPeriod } from './helpStats';
import './help.css';

const PERIODS: Array<{ id: HelpPeriod; key: 'help.d7' | 'help.d30' | 'help.all' }> = [
  { id: 7, key: 'help.d7' },
  { id: 30, key: 'help.d30' },
  { id: null, key: 'help.all' },
];
/** Rows of the recent list shown at first, and added by "Show more". */
const PAGE = 20;

const share = (n: number, total: number): number => (total ? Math.round((n / total) * 100) : 0);
// Names in the grown-up tone (the @C variants: "Sprint", "Number line"), whichever child is selected.
const modeName = (id: string, locale: LocaleId): string => {
  const m = getMode(id);
  return m ? tk(locale, m.titleKey, {}, 'C') : id;
};
const skillName = (id: string, locale: LocaleId): string => tk(locale, `skill.${id}`, {}, 'C');
const puzzleName = (type: string, locale: LocaleId): string => tk(locale, 'help.puzzle', { type: tk(locale, `puzzle.type.${type}`, {}, 'C') });

export function HelpTab({ p }: { p: Profile }): JSX.Element {
  const t = useT();
  const [period, setPeriod] = useState<HelpPeriod>(30);
  const [shown, setShown] = useState(PAGE);
  // Rebuilding a question needs its generator; a feature mode's generators load on demand.
  const [gens, setGens] = useState(false);
  useEffect(() => {
    let live = true;
    const done = (): void => {
      if (live) setGens(true);
    };
    loadAllGenerators().then(done, done);
    return () => {
      live = false;
    };
  }, []);
  const at = useMemo(() => now(), [p]);
  const log = useMemo(() => wholeLog(p.id), [p]);
  const sum = useMemo(() => helpSummary(log, at, period), [log, period]);
  const weeks = useMemo(() => helpByWeek(log, at), [log]);
  const topics = useMemo(() => helpBy(log, at, period, 'topic'), [log, period]);
  const modes = useMemo(() => helpBy(log, at, period, 'mode'), [log, period]);
  const recent = useMemo(() => recentHelp(log), [log]);
  const pct = (n: number, total: number): string => percentText(share(n, total), t.locale);
  const kindLabel = (k: Help): string => t(`help.kind.${k}` as 'help.kind.none');
  const fmtDay = (d: string): string => formatDate(new Date(`${d}T12:00:00`), getLocale(t.locale), 'dayMonth');

  return (
    <div class="stack help-tab">
      <p class="muted">{t('help.intro')}</p>
      <div class="chips help-periods" role="group" aria-label={t('help.period')}>
        {PERIODS.map((x) => (
          <button type="button" class={`chip${period === x.id ? ' on' : ''}`} aria-pressed={period === x.id} onClick={() => setPeriod(x.id)}>
            {period === x.id && <Icon name="check" size={16} />}
            {t(x.key)}
          </button>
        ))}
      </div>

      <section class="card help-summary">
        <h2>{t('help.summary')}</h2>
        {sum.total ? (
          <>
            <div class="tiles">
              <div class="tile">
                <div class="tile-label">{t('help.answers')}</div>
                <div class="tile-value">{numberText(sum.total, t.locale)}</div>
              </div>
              <div class="tile">
                <div class="tile-label">{t('help.withHelp')}</div>
                <div class="tile-value">{pct(helpedCount(sum), sum.total)}</div>
                <div class="tile-sub">{t('help.ofAnswers', { n: helpedCount(sum), total: sum.total })}</div>
              </div>
              <div class="tile">
                <div class="tile-label">{t('help.kind.shown')}</div>
                <div class="tile-value">{pct(sum.shown, sum.total)}</div>
                <div class="tile-sub">{t('help.ofAnswers', { n: sum.shown, total: sum.total })}</div>
              </div>
            </div>
            <StackedBar
              ariaLabel={t('help.summary')}
              parts={HELP_KINDS.map((k, i) => ({ value: sum[k], cls: `help-l${i}`, tip: `${kindLabel(k)}: ${numberText(sum[k], t.locale)} · ${pct(sum[k], sum.total)}` }))}
            />
            <table class="data help-kinds">
              <tbody>
                {HELP_KINDS.map((k, i) => (
                  <tr data-kind={k}>
                    <td>
                      <i class={`lkey help-key help-l${i}`} /> {kindLabel(k)}
                    </td>
                    <td class="num">{numberText(sum[k], t.locale)}</td>
                    <td class="num">{pct(sum[k], sum.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p class="muted">{t('help.noAnswers')}</p>
        )}
        <p class="muted">{t('help.levels', { sprint: modeName('sprint', t.locale) })}</p>
      </section>

      <section class="card">
        <h2>{t('help.trend')}</h2>
        <BarChart
          data={weeks.map((w) => ({ label: fmtDay(w.monday), value: w.share === null ? 0 : w.share * 100 }))}
          format={(v) => percentText(Math.round(v), t.locale)}
          floor={10}
          ariaLabel={t('help.trend')}
          tickLabel={(l, i) => ((weeks.length - 1 - i) % 3 === 0 ? l : null)}
          tip={(d, i) => {
            const w = weeks[i]!;
            return w.n ? `${t('help.week', { date: d.label })}: ${pct(w.helped, w.n)} (${t('help.ofAnswers', { n: w.helped, total: w.n })})` : `${t('help.week', { date: d.label })}: ${t('help.weekNone')}`;
          }}
        />
        <details class="help-table">
          <summary>{t('help.asTable')}</summary>
          <table class="data">
            <thead>
              <tr>
                <th>{t('help.colWeek')}</th>
                <th>{t('help.answers')}</th>
                <th>{t('help.withHelp')}</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr>
                  <td>{fmtDay(w.monday)}</td>
                  <td class="num">{numberText(w.n, t.locale)}</td>
                  <td class="num">{w.n ? pct(w.helped, w.n) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section class="card help-where">
        <h2>{t('help.where')}</h2>
        <h3>{t('help.bySkill')}</h3>
        <Groups groups={topics} name={(g) => (g.puzzle ? puzzleName(g.id, t.locale) : skillName(g.id, t.locale))} />
        <h3>{t('help.byMode')}</h3>
        <Groups groups={modes} name={(g) => modeName(g.id, t.locale)} />
      </section>

      <section class="card help-recent">
        <h2>{t('help.recent')}</h2>
        {recent.length ? (
          <>
            <ul class="help-list">
              {recent.slice(0, shown).map((a) => (
                <Row a={a} ready={gens} />
              ))}
            </ul>
            {recent.length > shown && (
              <button type="button" class="btn help-more" onClick={() => setShown(shown + PAGE)}>
                {t('help.more', { n: Math.min(PAGE, recent.length - shown) })}
              </button>
            )}
          </>
        ) : (
          <p class="muted">{t('help.recentNone')}</p>
        )}
      </section>
    </div>
  );
}

/** Skills (or games) with answers in the period: the most help first; a bar for the share with help. */
function Groups({ groups, name }: { groups: HelpGroup[]; name: (g: HelpGroup) => string }): JSX.Element {
  const t = useT();
  const used = groups.filter((g) => g.helped > 0);
  if (!groups.length) return <p class="muted">{t('help.noAnswers')}</p>;
  if (!used.length) return <p class="muted">{t('help.noHelp')}</p>;
  const rest = groups.length - used.length;
  return (
    <>
      <ul class="hbars help-groups">
        {used.map((g) => (
          <li>
            <span class="hbar-label">{name(g)}</span>
            <span class="hbar-value">{percentText(share(g.helped, g.n), t.locale)}</span>
            <span class="hbar-track">
              <span class="hbar" style={{ width: `${share(g.helped, g.n)}%` }} />
            </span>
            <span class="help-group-sub muted">
              {t('help.groupRow', { n: g.n, helped: g.helped, shown: g.shown })}
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 && <p class="muted">{t('help.noHelpRest', { n: rest })}</p>}
    </>
  );
}

/** One answer given with help: the question, the answers, which help, the game and the day. */
function Row({ a, ready }: { a: HelpAnswer; ready: boolean }): JSX.Element {
  const t = useT();
  const locale = t.locale;
  // Rebuild once the generators are in (and again when the language changes).
  const d = useMemo(() => (a.item ? describeRecord(a.item, locale) : null), [a, locale, ready]);
  const date = formatDate(a.ts, getLocale(locale), 'medium');
  const level = HELP_KINDS.indexOf(a.help);
  return (
    <li class="help-row" data-help={a.help}>
      {a.puzzle ? (
        <>
          <p class="help-q">{puzzleName(a.puzzle.type, locale)}</p>
          <p class="help-ans">{a.puzzle.solved ? t('help.puzzleSolved', { n: a.puzzle.hints }) : t('help.puzzleShown')}</p>
        </>
      ) : (
        <>
          <p class="help-q">{d?.question ?? skillName(a.topic, locale)}</p>
          {d?.question && <p class="help-skill muted">{skillName(a.topic, locale)}</p>}
          <p class="help-ans">
            {d?.given === null ? t('help.wasShown') : a.item?.correct ? t('help.givenRight', { given: d?.given ?? '' }) : t('help.given', { given: d?.given ?? '' })}
            {!a.item?.correct && d?.correct && (
              <>
                {' '}
                <span>{t('help.correct', { answer: d.correct })}</span>
              </>
            )}
          </p>
        </>
      )}
      <p class="help-meta">
        <span class="help-chip">
          <i class={`lkey help-key help-l${level}`} /> {t(`help.kind.${a.help}` as 'help.kind.none')}
        </span>
        <span>{modeName(a.mode, locale)}</span>
        <span>{date}</span>
        {!a.first && <span>{t('help.retry')}</span>}
      </p>
    </li>
  );
}
