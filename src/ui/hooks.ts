import { useMemo } from 'preact/hooks';
import { getBand } from '../bands/registry';
import type { BandConfig } from '../bands/types';
import { getCosmetic } from '../core/rewards/cosmetics';
import type { Profile } from '../core/profile';
import { makeT, speakingLocale, type Translator } from '../i18n/i18n';
import { useStore } from '../app/store';
import type { HopperLook } from './components/NumberLine';

/**
 * Translator bound to the active player's locale and band (tone variants).
 * Should that locale's bundle still be on its way (bundles load on demand,
 * DESIGN §1.12), it stays on the language already shown, starts the load,
 * and re-renders once the bundle is in (the store's `locales` changes).
 */
export function useT(): Translator {
  const wanted = useStore((s) => s.profile?.locale ?? s.meta?.uiLocale ?? guessLocale());
  const loaded = useStore((s) => s.locales);
  const band = useStore((s) => s.profile?.band ?? 'B');
  const ready = loaded.includes(wanted);
  const locale = ready ? wanted : speakingLocale(wanted) ?? wanted;
  // makeT starts loading `wanted` when it is missing; the translator below speaks `locale` meanwhile.
  if (locale !== wanted) makeT(wanted, band);
  // A new translator once the bundle is in, so effects that depend on it (the page title) run again.
  return useMemo(() => makeT(String(locale), band), [locale, band, ready]);
}

export function useBand(): BandConfig {
  const band = useStore((s) => s.profile?.band ?? 'B');
  return getBand(band);
}

export function guessLocale(): string {
  if (typeof navigator === 'undefined') return 'en';
  return (navigator.languages ?? [navigator.language]).some((l) => l.toLowerCase().startsWith('mk')) ? 'mk' : 'en';
}

export function lookFor(p: Profile): HopperLook {
  const color = getCosmetic(p.cosmetics.equipped.color ?? p.avatar)?.value ?? '#4caf50';
  return {
    kind: getBand(p.band).hopper,
    color,
    hat: p.cosmetics.equipped.hat,
    pad: getCosmetic(p.cosmetics.equipped.pad ?? 'pad.lily')?.value ?? '#86efac',
  };
}

export function accentFor(p: Profile): string | undefined {
  const theme = p.cosmetics.equipped.theme;
  return theme ? getCosmetic(theme)?.value : undefined;
}
