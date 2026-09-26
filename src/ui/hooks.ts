import { useMemo } from 'preact/hooks';
import { getBand } from '../bands/registry';
import type { BandConfig } from '../bands/types';
import { getCosmetic } from '../core/rewards/cosmetics';
import type { Profile } from '../core/profile';
import { makeT, type Translator } from '../i18n/i18n';
import { useStore } from '../app/store';
import type { HopperLook } from './components/NumberLine';

/** Translator bound to the active player's locale and band (tone variants). */
export function useT(): Translator {
  const locale = useStore((s) => s.profile?.locale ?? s.meta?.uiLocale ?? guessLocale());
  const band = useStore((s) => s.profile?.band ?? 'B');
  return useMemo(() => makeT(String(locale), band), [locale, band]);
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
