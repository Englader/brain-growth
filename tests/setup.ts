/**
 * Runs before every test file. The app loads locale bundles and feature
 * modes' generators on demand (i18n/locales.ts, generators/registry.ts);
 * tests start with all of them in, as if imported eagerly, so they stay
 * synchronous. tests/i18n.test.ts and tests/lazy.test.tsx check this really
 * happened, so no test passes vacuously over an empty bundle or a stub.
 */
import { loadAllGenerators } from '../src/core/items/generators';
import { loadAllLocales } from '../src/i18n/locales';

await Promise.all([loadAllLocales(), loadAllGenerators()]);
