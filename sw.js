/* ============================================================
   Palestra PWA — service worker
   Strategia:
   - index.html → network-first (sempre aggiornato), cache come fallback offline
   - asset versionati (?v=) → cache-first (immutabili a parità di numero)
   - altri asset statici → cache-first con aggiornamento in background
   Bump SHELL_VERSION a ogni deploy per forzare l'aggiornamento.
   ============================================================ */
const SHELL_VERSION = 'shell-v34';

const STATIC_ASSETS = [
  './styles.css?v=33',
  './app.js?v=33',
  './auth.js?v=33',
  './config.js?v=33',
  './vendor/supabase.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_VERSION)
      .then((c) => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isHtml = url.pathname === '/' || url.pathname.endsWith('.html');

  if (isHtml) {
    // Network-first: l'utente vede sempre la versione più recente.
    // Se offline, servi l'ultima versione cachata.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL_VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Asset versionati e statici: cache-first (performance + offline).
  event.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => {
        if (res.ok) caches.open(SHELL_VERSION).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => cached)
    )
  );
});
