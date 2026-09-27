/**
 * The fraction bar: split it with the ± stepper, shade parts by tapping them,
 * check. The target is the shared stacked fraction; the readout under the bar
 * writes what the child built the same way (3 of 4 shaded is 3/4), so the
 * construction and the notation meet. Every equivalent bar is right (2/4 and
 * 4/8 for 1/2) unless the task fixes the number of parts.
 *
 * Changing the number of parts re-cuts the bar and clears the shading.
 */
import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { play as sfx } from '../../audio/sfx';
import type { PresentedItem } from '../../core/engine/session';
import type { fracBarOf } from '../../core/items/generators/workshop';
import { rat } from '../../core/rational';
import type { BandId, LocaleId } from '../../core/types';
import { checkFracBar, fracBarHints, fracBarRepr, MAX_BAR_PARTS } from '../../core/workshop';
import { getLocale } from '../../i18n/locales';
import { formatFraction } from '../../i18n/numbers';
import { numberText, solutionText } from '../../i18n/render';
import { Frac } from '../../ui/components/Prompts';
import { useT } from '../../ui/hooks';
import { HintLine, Praise, Stepper, Tools } from './parts';
import { useBuild } from './useBuild';

type FracTaskData = NonNullable<ReturnType<typeof fracBarOf>>;
interface Msg {
  key: string;
  params: Record<string, string | number>;
  tip: string | null;
}

export function FracBarBoard({ presented, task, locale, band, onNext }: { presented: PresentedItem; task: FracTaskData; locale: LocaleId; band: BandId; onNext: () => void }): JSX.Element {
  const t = useT();
  const item = presented.item;
  const { target } = task;
  const want = target.parts ?? target.d;
  const hints = useMemo(() => fracBarHints(target), [target]);
  const b = useBuild(presented, locale, band, hints);
  const [parts, setParts] = useState(1);
  const [shaded, setShaded] = useState<readonly number[]>([]);
  const [msg, setMsg] = useState<Msg | null>(null);
  const conv = getLocale(locale).numbers;
  const fr = (n: number, d: number): string => formatFraction(n, d, conv);
  const building = b.phase === 'build';

  const split = (p: number): void => {
    setParts(p);
    setShaded([]);
    setMsg(null);
  };

  const toggle = (i: number): void => {
    if (!building) return;
    sfx('tap');
    setShaded(shaded.includes(i) ? shaded.filter((x) => x !== i) : [...shaded, i].sort((a, c) => a - c));
    setMsg(null);
  };

  const check = (): void => {
    if (!building || !shaded.length) return;
    const given = { parts, shaded: [...shaded] };
    const g = b.check({ kind: 'built', value: rat(shaded.length, parts), repr: fracBarRepr(given) });
    if (g.invalid || g.correct) {
      setMsg(null);
      return;
    }
    const r = checkFracBar(target, given);
    const tip = r.misconception ? t.dyn(`mis.${r.misconception}.tip`) : null;
    setMsg(
      r.reason === 'wrongParts'
        ? { key: 'workshop.frac.wrongParts', params: { parts: want }, tip }
        : { key: 'workshop.frac.notYet', params: { made: fr(shaded.length, parts), frac: fr(target.n, target.d) }, tip },
    );
  };

  const reveal = (): void => {
    b.reveal();
    setParts(want);
    setShaded(Array.from({ length: (target.n * want) / target.d }, (_, i) => i));
    setMsg(null);
  };

  const shownParts = parts;
  const count = shaded.length;
  const sayLines = item.solution.filter((s): s is Extract<typeof s, { k: 'say' }> => s.k === 'say');

  return (
    <>
      <section class="prompt ws-prompt">
        {presented.attempt > 1 && <span class="badge">{t('play.again')}</span>}
        <div class="expr ws-target" dir="ltr">
          <Frac n={numberText(target.n, locale)} d={numberText(target.d, locale)} />
        </div>
        <p class="prompt-text">{target.parts === undefined ? t('workshop.frac.make') : t('workshop.frac.withParts', { parts: target.parts })}</p>
        <HintLine b={b} />
      </section>

      <section class="ws-bar-wrap">
        <div class={`ws-bar${building ? '' : ' done'}`} role="group" aria-label={t('workshop.frac.parts')}>
          {Array.from({ length: shownParts }, (_, i) => (
            <button
              type="button"
              class={`ws-part${shaded.includes(i) ? ' on' : ''}`}
              aria-pressed={shaded.includes(i)}
              aria-label={t('workshop.frac.part', { i: i + 1, parts: shownParts })}
              disabled={!building}
              onClick={() => toggle(i)}
            />
          ))}
        </div>
        <div class="ws-readout" aria-live="polite">
          <span>{t('workshop.frac.shaded')}</span>
          <Frac n={numberText(count, locale)} d={numberText(shownParts, locale)} cls="ws-made" />
        </div>
        <Stepper
          cls="ws-parts"
          label={t('workshop.frac.parts')}
          value={parts}
          min={1}
          max={MAX_BAR_PARTS}
          down={t('workshop.frac.fewer')}
          up={t('workshop.frac.more')}
          disabled={!building}
          locale={locale}
          onChange={split}
        />
      </section>

      <section class="feedback ws-feedback" aria-live="assertive">
        {building && !count && !msg && <p class="note">{t('workshop.frac.none')}</p>}
        {building && b.last?.invalid && <p class="invalid">{t('play.invalid')}</p>}
        {building && msg && (
          <div class="ws-msg">
            <p>{t.dyn(msg.key, msg.params)}</p>
            {msg.tip && <p class="tip">{msg.tip}</p>}
          </div>
        )}
        {b.phase === 'solved' && (
          <>
            <Praise b={b} />
            {(count !== target.n || shownParts !== target.d) && (
              <div class="ws-same">
                <span class="expr ws-eq" dir="ltr">
                  <Frac n={numberText(count, locale)} d={numberText(shownParts, locale)} />
                  <span class="expr-op">=</span>
                  <Frac n={numberText(target.n, locale)} d={numberText(target.d, locale)} />
                </span>
                <span>{t('workshop.frac.same')}</span>
              </div>
            )}
            {b.firstWrong && b.willReturn && <p class="note">{t('play.comesBack')}</p>}
          </>
        )}
        {b.phase === 'revealed' && (
          <div class="explain ws-explain">
            <h2>{t('workshop.reveal')}</h2>
            {sayLines.map((s) => (
              <p class="step">{solutionText(s, locale, band)}</p>
            ))}
            {b.willReturn && <p class="note">{t('play.comesBack')}</p>}
          </div>
        )}
      </section>

      <Tools b={{ ...b, reveal }}>
        {building ? (
          <button type="button" class="btn primary big ws-check" disabled={!count} onClick={check}>
            {t('workshop.check')}
          </button>
        ) : (
          <button type="button" class="btn primary big ws-next" onClick={onNext}>
            {t('workshop.next')}
          </button>
        )}
      </Tools>
    </>
  );
}
