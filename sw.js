/* ============================================================
   Palestra PWA — service worker
   - App shell: cache-first (veloce, offline)
   - Dati (schede.json): network-first (aggiornamenti dalla chat)
   Aggiorna SHELL_VERSION quando cambiano html/css/js.
   ============================================================ */
const SHELL_VERSION = 'shell-v1';
const DATA_CACHE = 'data-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_VERSION).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_VERSION && k !== DATA_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Dati: network-first, fallback cache
  if (url.pathname.endsWith('/data/schede.json') || url.pathname.endsWith('schede.json')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(DATA_CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // App shell / resto: cache-first, poi rete
  event.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(SHELL_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached)
    )
  );
});
