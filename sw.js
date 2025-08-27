// sw.js — simple offline shell caching with activation cleanup
const CACHE_NAME = 'phone-keypad-v1';
const OFFLINE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/apple-touch-icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  '/numpad.png',
  '/screenshot.png'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.all(OFFLINE_ASSETS.map(url =>
        fetch(url, { cache: 'no-cache' }).then(r => {
          if (!r || r.status >= 400) return;
          return cache.put(url, r.clone());
        }).catch(() => {})
      ));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => {
        if (k !== CACHE_NAME) return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evt) => {
  const req = evt.request;

  if (req.mode === 'navigate') {
    evt.respondWith((async () => {
      try {
        const networkResp = await fetch(req);
        try {
          const cache = await caches.open(CACHE_NAME);
          cache.put('/index.html', networkResp.clone()).catch(()=>{});
        } catch(e){}
        return networkResp;
      } catch (err) {
        const cached = await caches.match('/index.html');
        return cached || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' }});
      }
    })());
    return;
  }

  evt.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(networkResp => {
        if (req.method === 'GET' && networkResp && networkResp.status === 200 && new URL(req.url).origin === location.origin) {
          caches.open(CACHE_NAME).then(cache => {
            try { cache.put(req, networkResp.clone()); } catch(e) {}
          });
        }
        return networkResp;
      }).catch(() => cached || Promise.reject('network-and-cache-failed'));
    })
  );
});
