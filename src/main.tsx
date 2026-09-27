import { render } from 'preact';
import './styles/fonts.css';
import './styles/app.css';
import './modes';
import './ui/widgets';
import { App } from './app/App';
import { boot } from './app/actions';
import { loadStartLocale, prefetchLocales, startLocale, trackLocales } from './app/localeActions';
import { startRouter } from './app/router';
import { applyTestParams, initStorage } from './app/services';
import { installTestHooks } from './app/testHooks';
import { setUrlOverrides } from './core/flags';
import { registerServiceWorker } from './sw/register';

// End-to-end runs only (?e2e in the URL): ?now= and ?seed= must apply before boot reads the clock.
const e2e = applyTestParams(location.search);
setUrlOverrides(location.search);
trackLocales();
// The first screen's language bundle downloads while storage gets ready (both before boot).
const first = loadStartLocale(startLocale());
// The boot splash shows until storage is ready: log months are moved to and read from IndexedDB first.
render(<App />, document.getElementById('app')!);
void Promise.all([initStorage(), first])
  // Ask again through the storage now in use (the same answer in practice, and then instant).
  .then(() => loadStartLocale(startLocale()))
  .then(() => {
    boot();
    if (e2e) installTestHooks();
    startRouter();
    prefetchLocales();
  });
registerServiceWorker();
