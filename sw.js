const CACHE_NAME = 'diario-cache-v14-1'; // Versione aggiornata
const assetsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js?v=14.1', // Cacheiamo la versione specifica
  './manifest.json'
];

// Installazione
self.addEventListener('install', event => {
  self.skipWaiting(); // Forza attivazione
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(assetsToCache))
  );
});

// Attivazione e Pulizia Vecchie Cache
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('Pulizia vecchia cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});