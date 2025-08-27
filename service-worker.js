// sw.js — simple offline shell caching with sensible cache-busting and activation cleanup
const CACHE_NAME = 'phone-keypad-v1';
const OFFLINE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon-180.png',
  '/numpad.png',
  '/screenshot.png'
];

// Install: cache offline assets
self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Add all assets; ignore failures for individual resources to avoid blocking install
      return Promise.all(OFFLINE_ASSETS.map(url =>
        fetch(url, {cache: "no-cache"}).then(r => {
          if (!r || r.status >= 400) return;
          return cache.put(url, r.clone());
        }).catch(() => {})
      ));
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => {
        if (k !== CACHE_NAME) return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

// Fetch:
// - Navigation requests (HTML) -> network-first (so start_url is fresh), fallback to cached index
// - Other requests -> cache-first, falling back to network
self.addEventListener('fetch', (evt) => {
  const req = evt.request;

  // Navigation requests: try network, fallback to cache index
  if (req.mode === 'navigate') {
    evt.respondWith((async () => {
      try {
        const networkResp = await fetch(req);
        // warm the cache with the fresh index.html for offline fallback
        const cache = await caches.open(CACHE_NAME);
        try { cache.put('/index.html', networkResp.clone()); } catch (e) {}
        return networkResp;
      } catch (err) {
        const cached = await caches.match('/index.html');
        return cached || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' }});
      }
    })());
    return;
  }

  // For other requests: respond from cache, otherwise fetch and cache
  evt.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(networkResp => {
        // Optionally cache same-origin GET responses
        if (req.method === 'GET' && networkResp && networkResp.status === 200 && new URL(req.url).origin === location.origin) {
          caches.open(CACHE_NAME).then(cache => {
            try { cache.put(req, networkResp.clone()); } catch (e) {}
          });
        }
        return networkResp;
      }).catch(() => {
        // final fallback: for images, return a tiny transparent PNG? (omitted here)
        return cached || Promise.reject('network-and-cache-failed');
      });
    })
  );
});
