/* Hopa service worker (generated from src/sw/sw.template.js at build time).
 * App-shell strategy: everything the game needs is precached at install, so
 * a bad connection can never break a session or a streak. Updates install in
 * the background and wait until the page says it is safe (see register.ts). */
const VERSION = 'b7344075c40f';
const ASSETS = ["./","./assets/index-BmdQ58p2.css","./assets/index-BtctcHiU.js","./assets/inter-cyrillic-wght-normal-DqGufNeO.woff2","./assets/inter-latin-wght-normal-Dx4kXJAl.woff2","./assets/nunito-cyrillic-wght-normal-CY6AOgYE.woff2","./assets/nunito-latin-wght-normal-BzFMHfZw.woff2","./icons/icon-192.png","./icons/icon-512.png","./icons/icon.svg","./manifest.webmanifest"];
const CACHE = `hopa-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Only our own caches: other projects share this github.io origin.
      await Promise.all(keys.filter((k) => k.startsWith('hopa-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then(async (c) => (await c.match('./')) || (await c.match('index.html')) || fetch(req)),
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') c.put(req, res.clone());
      return res;
    }),
  );
});
