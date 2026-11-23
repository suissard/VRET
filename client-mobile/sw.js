const CACHE_NAME = 'vret-mobile-v1';
const ASSETS = [
  '/mobile/',
  '/mobile/index.html',
  '/mobile/styles.css',
  '/mobile/app.js',
  '/shared/protocol.js',
  '/shared/scenes-schema.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
