/**
 * The year bar on a child's home (DESIGN A-29): ‹ 4 | 5. одделение | 6 ›.
 * Only years with something to play for this child are listed; the child's
 * own year (from age) wears a small star, so paging up and down reads as
 * exploring rather than being moved. Band A sees big numerals (and a sprout
 * for pre-school); the look always follows the child's band, never the year.
 */
import type { JSX } from 'preact';
import type { Profile } from '../../core/profile';
import { ownYear } from '../../core/years';
import type { Translator } from '../../i18n/i18n';
import { Icon } from '../components/Icon';
import { useT } from '../hooks';
import './years.css';

export function yearLabel(t: Translator, year: number): string {
  return t('year.label', { n: String(year) });
}

function YearNum({ year, own }: { year: number; own: boolean }): JSX.Element {
  const t = useT();
  return (
    <>
      <span class="yb-num">{year === 0 ? <Icon name="sprout" size={24} /> : year}</span>
      <span class="yb-word">{yearLabel(t, year)}</span>
      {own && <Icon name="star" size={14} solid class="yb-own-dot" />}
    </>
  );
}

export function YearBar({ p, year, years, onChange }: { p: Profile; year: number; years: readonly number[]; onChange: (y: number) => void }): JSX.Element {
  const t = useT();
  const own = ownYear(p.age);
  const i = years.indexOf(year);
  const prev = i > 0 ? years[i - 1]! : null;
  const next = i >= 0 && i < years.length - 1 ? years[i + 1]! : null;
  const bandA = p.band === 'A';
  return (
    <nav class={`year-bar${bandA ? ' year-bar-a' : ''}`} aria-label={t('year.bar')}>
      {prev !== null ? (
        <button type="button" class="yb-side yb-prev" aria-label={t('year.prev', { year: yearLabel(t, prev) })} onClick={() => onChange(prev)}>
          <Icon name="back" size={20} />
          <YearNum year={prev} own={prev === own} />
        </button>
      ) : (
        <span class="yb-side yb-empty" />
      )}
      <div class="yb-current" aria-live="polite">
        {bandA && <span class="yb-big">{year === 0 ? <Icon name="sprout" size={34} /> : year}</span>}
        <strong class="yb-label">{yearLabel(t, year)}</strong>
        {year === own && (
          <span class="yb-own">
            <Icon name="star" size={14} solid /> {t('year.own')}
          </span>
        )}
      </div>
      {next !== null ? (
        <button type="button" class="yb-side yb-next" aria-label={t('year.next', { year: yearLabel(t, next) })} onClick={() => onChange(next)}>
          <YearNum year={next} own={next === own} />
          <Icon name="back" size={20} style={{ transform: 'scaleX(-1)' }} />
        </button>
      ) : (
        <span class="yb-side yb-empty" />
      )}
    </nav>
  );
}
