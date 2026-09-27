/**
 * "Other ways": the solver's distinct solutions for this deal (simplest
 * first), with the ones the child found ticked and listed first. Shown after
 * a solve or a reveal, never before.
 */
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import type { Rational } from '../../core/rational';
import { canonicalKey, parseRepr, type TExpr } from '../../core/target/expr';
import type { LocaleId } from '../../core/types';
import { Icon } from '../../ui/components/Icon';
import { useT } from '../../ui/hooks';
import { Expr } from './Num';

const SHOWN = 8;

export function OtherWays(props: { ways: readonly string[]; total: number; found: ReadonlySet<string>; target: Rational; locale: LocaleId }): JSX.Element {
  const t = useT();
  const rows = useMemo(() => {
    const list = props.ways
      .map((w) => parseRepr(w))
      .filter((e): e is TExpr => e !== null)
      .map((e) => ({ e, found: props.found.has(canonicalKey(e) ?? '') }));
    return [...list.filter((r) => r.found), ...list.filter((r) => !r.found)].slice(0, SHOWN);
  }, [props.ways, props.found]);
  return (
    <section class="tways card">
      <h2>{t('target.otherWays')}</h2>
      <p class="muted">{t('target.waysTotal', { n: props.total })}</p>
      <ul class="tways-list">
        {rows.map((r) => (
          <li class={r.found ? 'found' : ''}>
            <Expr e={r.e} locale={props.locale} result={props.target} />
            {r.found && <Icon name="check" size={20} label={t('target.foundByYou')} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
