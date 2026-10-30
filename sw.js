/* ============================================================
   Al-shwareb service worker — offline support (PWA)
   Bump CACHE_VERSION whenever app files change so devices
   pick up the new version.

   Strategy:
   - Page navigations  -> network-first, cached shell as offline
     fallback. A reload must never get stuck serving a broken or
     missing cached page when the network is available.
   - Static assets      -> cache-first, network fallback, and every
     successful network response is cached for future offline use.
   ============================================================ */

const CACHE_VERSION = 'al-shwareb-v15';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './css/pf.css',
  './js/storage.js',
  './js/app.js',
  './js/pf.js',
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
      // Cache each file independently: one failed download must not
      // abort the whole install (cache.addAll is all-or-nothing).
      const results = await Promise.allSettled(
        CORE_ASSETS.map((url) => cache.add(url))
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed) console.warn(`Al-shwareb SW: ${failed} asset(s) failed to precache`);

      // Ensure the app shell exists under both URL spellings, because
      // Android may launch '/' or '/index.html'.
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

function cacheResponse(request, response) {
  if (!response.ok) return;
  const copy = response.clone();
  caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin goes straight to network

  // ---- Navigations: network-first so reloads behave like a normal website ----
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cacheResponse(request, response);
          return response;
        })
        .catch(() =>
          // Offline (or network blocked): use the cached page if we have one.
          caches
            .match(request)
            .then((cached) => cached || appShellFallback())
        )
    );
    return;
  }

  // ---- Static assets: cache-first, then network, runtime-cache the result ----
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          cacheResponse(request, response);
          return response;
        })
        .catch(() => Response.error());
    })
  );
});
