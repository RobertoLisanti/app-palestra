/* ============================================================
   Palestra PWA — service worker
   App shell: cache-first (offline). I dati arrivano da Supabase
   (richieste cross-origin, non cacheate qui; copia offline in
   localStorage lato app). Bump SHELL_VERSION quando cambi i file.
   ============================================================ */
const SHELL_VERSION = 'shell-v23';

// gli asset versionati (?v=) corrispondono a quelli richiesti da index.html,
// così la cache-first li serve offline e ogni bump di versione li rinfresca.
const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css?v=10',
  './app.js?v=10',
  './auth.js?v=10',
  './config.js?v=10',
  './vendor/supabase.js',
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
      Promise.all(keys.filter((k) => k !== SHELL_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Solo richieste same-origin (l'app shell). Supabase passa sempre dalla rete.
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached)
    )
  );
});
