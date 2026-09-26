import { render } from 'preact';
import './styles/fonts.css';
import './styles/app.css';
import './modes';
import { App } from './app/App';
import { boot } from './app/actions';
import { startRouter } from './app/router';
import { setUrlOverrides } from './core/flags';
import { getState } from './app/store';
import { registerServiceWorker } from './sw/register';

setUrlOverrides(location.search);
boot();
startRouter();
render(<App />, document.getElementById('app')!);
registerServiceWorker();

// End-to-end test hook (tests/e2e): read-only state access, only with ?e2e in the URL.
if (new URLSearchParams(location.search).has('e2e')) (window as unknown as { __hopa: unknown }).__hopa = { getState };
