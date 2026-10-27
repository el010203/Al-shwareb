/* ============================================================
   Al-shwareb service worker — offline support (PWA)
   Bump CACHE_VERSION whenever app files change so devices
   pick up the new version.
   ============================================================ */

const CACHE_VERSION = 'al-shwareb-v6';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/storage.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/favicon-32.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Cache each file independently: one missing/failed file must
      // never abort the whole install (addAll is all-or-nothing).
      const results = await Promise.allSettled(
        CORE_ASSETS.map((url) => cache.add(url))
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed) console.warn(`Al-shwareb SW: ${failed} asset(s) failed to precache`);

      // Make sure the app shell is available under both URL spellings,
      // because Android may launch '/' or '/index.html'.
      const shell = await cache.match('./index.html');
      if (shell) await cache.put('./', shell.clone());
    })().then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function appShellFallback() {
  return (
    (await caches.match('./index.html')) ||
    (await caches.match('./')) ||
    Response.error()
  );
}

// Cache-first for GET requests, falling back to the network and
// caching successful responses so newly visited files work offline too.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && new URL(request.url).origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline: any navigation falls back to the cached app shell.
          if (request.mode === 'navigate') return appShellFallback();
          return Response.error();
        });
    })
  );
});
