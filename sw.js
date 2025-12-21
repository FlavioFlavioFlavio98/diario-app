const CACHE_NAME = 'diario-cache-v14-modular'; // CAMBIA QUESTO NOME AD OGNI AGGIORNAMENTO
const assetsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

// Installazione: scarica i file
self.addEventListener('install', event => {
  self.skipWaiting(); // Forza l'attivazione immediata del nuovo SW
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Aperta cache:', CACHE_NAME);
        return cache.addAll(assetsToCache);
      })
  );
});

// Attivazione: pulizia vecchie cache
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('Rimozione vecchia cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim()) // Prende il controllo di tutti i tab aperti
  );
});

// Fetch: serve i file dalla cache, se non ci sono va in rete
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});