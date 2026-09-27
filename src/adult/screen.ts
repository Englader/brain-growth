/**
 * The grown-ups' dashboard is its own chunk (modes/lazy.tsx): most visits
 * never open it. Holding the "Grown-ups" button starts the fetch, so it is in
 * by the time the 2-second hold ends. The dashboard lists both languages (the
 * recording checklist, the voice report), so every locale bundle comes with it.
 */
import { loadAllLocales } from '../i18n/locales';
import { lazyScreen } from '../modes/lazy';

export const AdultScreen = lazyScreen(() => Promise.all([import('./Adult'), loadAllLocales()]).then(([m]) => m.Adult));
