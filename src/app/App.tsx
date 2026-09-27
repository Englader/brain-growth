import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { Adult } from '../adult/Adult';
import { getBand } from '../bands/registry';
import { getLocale } from '../i18n/locales';
import { getMode, modesFor } from '../modes/registry';
import { Toast } from '../ui/components/common';
import { accentFor, useT } from '../ui/hooks';
import { Create } from '../ui/screens/Create';
import { Family, RivalImport } from '../ui/screens/Family';
import { Home } from '../ui/screens/Home';
import { Profiles } from '../ui/screens/Profiles';
import { Results } from '../ui/screens/Results';
import { Settings } from '../ui/screens/Settings';
import { Trophies } from '../ui/screens/Trophies';
import { Wardrobe } from '../ui/screens/Wardrobe';
import { receiveRival } from './actions';
import { navigate } from './router';
import { useStore } from './store';

function Screen(): JSX.Element | null {
  const route = useStore((s) => s.route);
  const profile = useStore((s) => s.profile);
  const profiles = useStore((s) => s.profiles);
  const session = useStore((s) => s.session);
  const meta = useStore((s) => s.meta);

  if (route.startsWith('/rival/')) return <RivalImport payload={route.slice(7)} />;
  if (route === '/adult') return <Adult />;
  if (route === '/new' || (!profile && profiles.length === 0)) return <Create />;
  if (!profile) return <Profiles />;
  // Generic mode routes: /intro/<id> (the mode's pre-session screen) and /play/<id>.
  // Engine modes need the store's session; standalone modes (engine: false) run their own.
  const [, section, id] = route.split('/');
  if (section === 'intro' || section === 'play') {
    const mode = getMode(id ?? '');
    const visible = !!mode && modesFor(profile, meta?.deviceFlags ?? {}).includes(mode);
    const C = !mode || !visible ? null : section === 'intro' ? mode.intro ?? null : mode.engine === false || session?.modeId === mode.id ? mode.Component : null;
    if (!C) {
      navigate('/', true);
      return null;
    }
    return <C key={section === 'play' ? session?.id ?? mode!.id : mode!.id} />;
  }
  switch (route) {
    case '/results':
      return <Results />;
    case '/trophies':
      return <Trophies />;
    case '/wardrobe':
      return <Wardrobe />;
    case '/family':
      return <Family />;
    case '/settings':
      return <Settings />;
    default:
      return <Home />;
  }
}

export function App(): JSX.Element {
  const booted = useStore((s) => s.booted);
  const profile = useStore((s) => s.profile);
  const route = useStore((s) => s.route);
  const t = useT();
  const band = profile ? getBand(profile.band) : null;

  useEffect(() => {
    document.documentElement.lang = getLocale(t.locale).bcp47;
    document.title = t('app.name');
  }, [t]);

  useEffect(() => {
    if (route.startsWith('/rival/')) receiveRival(route.slice(7));
  }, [route]);

  if (!booted) return <div class="boot" />;
  const accent = profile ? accentFor(profile) : undefined;
  return (
    <div
      class="app"
      data-band={band?.id ?? 'none'}
      data-theme={route === '/adult' ? 'adult' : band?.theme ?? 'lagoon'}
      style={accent ? { '--accent': accent } : undefined}
    >
      <Screen />
      <Toast />
    </div>
  );
}
