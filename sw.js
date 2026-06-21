/* ============================================================
   Palestra PWA — service worker
   Strategia: NETWORK-FIRST per tutto (same-origin).
   - Online  → prende sempre i file freschi dalla rete e aggiorna
               la copia in cache. L'utente ha SEMPRE l'ultima versione
               senza dover fare nulla (niente svuota-cache, niente
               reinstallazioni, niente bump di versione).
   - Offline → serve l'ultima copia salvata in cache.
   I dati Supabase (cross-origin) passano sempre dalla rete.
   ============================================================ */
const CACHE = 'andygym-cache';

// shell minima pre-cachata per il primo avvio offline (best-effort:
// se un file non c'è non blocca l'installazione).
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase & co. → rete diretta

  // Network-first: rete fresca, cache come fallback offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
