import { render } from 'preact';
import './styles/fonts.css';
import './styles/app.css';
import './modes';
import './ui/widgets';
import { App } from './app/App';
import { boot } from './app/actions';
import { startRouter } from './app/router';
import { applyTestParams } from './app/services';
import { installTestHooks } from './app/testHooks';
import { setUrlOverrides } from './core/flags';
import { registerServiceWorker } from './sw/register';

// End-to-end runs only (?e2e in the URL): ?now= and ?seed= must apply before boot reads the clock.
const e2e = applyTestParams(location.search);
setUrlOverrides(location.search);
boot();
if (e2e) installTestHooks();
startRouter();
render(<App />, document.getElementById('app')!);
registerServiceWorker();
