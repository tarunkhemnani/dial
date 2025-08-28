// Minimal service worker to cache shell for offline usage
const CACHE_NAME = 'phone-keypad-v1';
const OFFLINE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon-180.png',
  '/icons/apple-touch-icon-152.png', // optional
  '/icons/apple-touch-icon-120.png', // optional
  '/favicon-32x32.png'
];



self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (evt) => {
  // network-first for start page, cache-first otherwise
  if(evt.request.mode === 'navigate'){
    evt.respondWith(
      fetch(evt.request).catch(()=> caches.match('/index.html'))
    );
    return;
  }
  evt.respondWith(
    caches.match(evt.request).then(cached => cached || fetch(evt.request).catch(()=>{}))
  );
});


