import { render } from 'preact';
import './styles/fonts.css';
import './styles/app.css';
import './modes';
import './ui/widgets';
import { App } from './app/App';
import { boot } from './app/actions';
import { startRouter } from './app/router';
import { applyTestParams, initStorage } from './app/services';
import { installTestHooks } from './app/testHooks';
import { setUrlOverrides } from './core/flags';
import { registerServiceWorker } from './sw/register';

// End-to-end runs only (?e2e in the URL): ?now= and ?seed= must apply before boot reads the clock.
const e2e = applyTestParams(location.search);
setUrlOverrides(location.search);
// The boot splash shows until storage is ready: log months are moved to and read from IndexedDB first.
render(<App />, document.getElementById('app')!);
void initStorage().then(() => {
  boot();
  if (e2e) installTestHooks();
  startRouter();
});
registerServiceWorker();
