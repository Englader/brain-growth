/**
 * Runs before every test file: locale bundles load on demand in the app
 * (i18n/locales.ts), so tests start with all of them in, as the app has them
 * after its idle prefetch. tests/i18n.test.ts checks this really happened, so
 * the parity tests can never pass vacuously over empty bundles.
 */
import { loadAllLocales } from '../src/i18n/locales';

await loadAllLocales();
