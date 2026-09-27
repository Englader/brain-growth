/**
 * Small Dice Race pieces shared by the setup, pass, turn and results screens:
 * a subtree themed for ONE player (their band's theme and accent, whatever
 * the active child's is), that player's language toggle, and the dice faces.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { switchLocale } from '../../app/actions';
import { useStore } from '../../app/store';
import { getBand } from '../../bands/registry';
import type { DiceRoll, IntForm } from '../../core/dice';
import type { Profile } from '../../core/profile';
import { makeT, speakingLocale, type Translator } from '../../i18n/i18n';
import { allLocales, getLocale } from '../../i18n/locales';
import { numberText } from '../../i18n/render';
import { Dots } from '../../ui/components/Prompts';
import { accentFor } from '../../ui/hooks';
import './dice.css';

/** data-theme / data-band / accent for a subtree that belongs to player `p` (see dice.css `.dice-themed`). */
export function themeOf(p: Profile): { 'data-theme': string; 'data-band': string; style: JSX.CSSProperties } {
  const band = getBand(p.band);
  const accent = accentFor(p) ?? (band.id === 'C' ? '#818cf8' : '#f59e0b');
  return { 'data-theme': band.theme, 'data-band': band.id, style: { '--accent': accent } as JSX.CSSProperties };
}

/**
 * A translator in this player's language and band tone (not the active
 * child's). Language bundles load on demand: until this one is in, it speaks
 * a loaded language, and the component re-renders once it arrives.
 */
export function usePlayerT(p: Pick<Profile, 'locale' | 'band'> | null | undefined): Translator {
  const loaded = useStore((s) => s.locales);
  const wanted = p?.locale ?? 'mk';
  const band = p?.band ?? 'B';
  const ready = loaded.includes(wanted);
  const shown = ready ? wanted : speakingLocale(wanted) ?? wanted;
  return useMemo(() => {
    if (shown !== wanted) makeT(wanted, band); // starts loading the wanted bundle
    return makeT(shown, band);
  }, [shown, wanted, band, ready]);
}

/** Same, outside a hook (lane and result lists; their parent subscribes to the store's `locales`). */
export function playerT(p: Pick<Profile, 'locale' | 'band'>): Translator {
  return makeT(speakingLocale(p.locale) ?? p.locale, p.band);
}

/** A whole screen in one player's theme. */
export function DicePage({ p, children, class: cls = '' }: { p: Profile; children: ComponentChildren; class?: string }): JSX.Element {
  return (
    <div class="dice-themed dice-page" {...themeOf(p)}>
      <div class={`screen dice-screen ${cls}`}>{children}</div>
    </div>
  );
}

/** The language switch for a player who may not be the active child (switchLocale with their id). */
export function PlayerLang({ p, t }: { p: Profile; t: Translator }): JSX.Element {
  const pending = useStore((s) => s.localePending);
  return (
    <div class="lang" role="group">
      {allLocales().map((l) => {
        // A language whose bundle is still on its way: busy, not yet pressed (as LangToggle).
        const busy = pending === l.id && l.id !== p.locale;
        return (
          <button
            type="button"
            class={l.id === p.locale ? 'on' : busy ? 'busy' : ''}
            aria-pressed={l.id === p.locale}
            aria-busy={busy || undefined}
            aria-label={t(busy ? 'lang.loading' : 'lang.switchTo', { lang: l.nativeName })}
            lang={l.bcp47}
            onClick={() => switchLocale(l.id, p.id)}
          >
            {l.short}
          </button>
        );
      })}
    </div>
  );
}

/** The form die's face, with the locale's operator glyphs: +, −, + (−), − (−). */
function formFace(form: IntForm, locale: string): string {
  const ops = getLocale(locale).ops;
  const op = form.startsWith('a+') ? ops['+'] : ops['-'];
  return form.includes('(-b)') ? `${op}(${ops['-']})` : op;
}

/** The dice of a roll: dots for A and B, a number die and a sign die for C. */
export function DiceFaces({ roll, t }: { roll: DiceRoll; t: Translator }): JSX.Element {
  switch (roll.band) {
    case 'A':
      return (
        <div class="dice-faces one" data-dots={roll.dots}>
          <Dots count={roll.dots} layout="dice" label={t('dice.die', { n: roll.dots })} />
        </div>
      );
    case 'B':
      return (
        <div class="dice-faces two">
          {roll.dice.map((n) => (
            <Dots count={n} layout="dice" label={t('dice.die', { n })} />
          ))}
        </div>
      );
    case 'C':
      return (
        <div class="dice-faces two">
          <span class="die-face num" role="img" aria-label={t('dice.numberDie', { n: roll.n })}>
            {numberText(roll.n, t.locale)}
          </span>
          <span class="die-face form" role="img" aria-label={t('dice.formDie')}>
            {formFace(roll.form, t.locale)}
          </span>
        </div>
      );
  }
}
