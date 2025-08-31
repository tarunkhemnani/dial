// service-worker.js
// Offline-first, iOS-friendly service worker for the Phone Keypad PWA.
//
// Key features:
// - Precache all render-critical assets (HTML, CSS, JS, icons, images).
// - Network-first for navigations with a short timeout; fallback to cached index.html.
// - Cache-first for same-origin static assets (.css, .js, images, icons, manifest).
// - Graceful fallbacks when offline (image fallback to apple-touch icon).
// - Versioned cache with cleanup of old versions.
// - Works when hosted at the domain root or a subdirectory (builds URLs from scope).
//
// IMPORTANT: Open the app once online to let the SW install and fill the cache before going offline.

const CACHE_VERSION = 'v3'; // bump on deploy to refresh cache
const CACHE_NAME = `phone-keypad-${CACHE_VERSION}`;

// Compute base path from SW scope so it works under subdirectories too.
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');

// List assets relative to BASE; no leading slash needed.
const ASSET_PATHS = [
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'apple-touch-icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'favicon-32x32.png',
  'numpad.png',
  'screenshot.png',
  'service-worker.js'
];

// Build absolute URLs scoped to BASE.
function urlFromBase(p) {
  const clean = String(p || '').replace(/^\/+/, '');
  return `${BASE}/${clean}`;
}
const ASSETS_TO_CACHE = ASSET_PATHS.map(urlFromBase);

// Small helper to detect images.
function isImageRequest(request) {
  if (request.destination && request.destination === 'image') return true;
  try {
    const url = new URL(request.url);
    return /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(url.pathname);
  } catch (e) {
    return false;
  }
}

// A short network timeout for navigations (milliseconds)
const NAV_TIMEOUT_MS = 3500;

// Install: cache the app shell
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Try addAll first; if a single file fails, fall back to adding individually.
      try {
        await cache.addAll(ASSETS_TO_CACHE);
      } catch (err) {
        console.warn('SW: cache.addAll failed — fallback to individual add', err);
        await Promise.all(
          ASSETS_TO_CACHE.map(async (asset) => {
            try {
              await cache.add(asset);
            } catch (e) {
              console.warn('SW: failed to cache', asset, e);
            }
          })
        );
      }
    })
  );
});

// Activate: cleanup old versions and take control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Fetch strategy:
// - Navigations: network-first with timeout -> fallback to cached index.html.
// - Same-origin static assets (css/js/images/manifest): cache-first -> network -> fallback.
// - Cross-origin: pass-through network; no caching.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Handle navigations (HTML documents)
  const accept = req.headers.get('accept') || '';
  const isHTMLNavigation =
    req.mode === 'navigate' || accept.includes('text/html');

  if (isHTMLNavigation) {
    event.respondWith(handleNavigation(req));
    return;
  }

  // For other same-origin GETs: cache-first for app shell assets and images
  if (isSameOrigin) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Default: try network, no caching
  event.respondWith(fetch(req).catch(() => new Response(null, { status: 503, statusText: 'Service Unavailable' })));
});

// Network-first with timeout for navigations, fallback to cached index.html
async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const indexUrl = urlFromBase('index.html');

  // Race network against a short timeout to avoid long hangs offline
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve(undefined), NAV_TIMEOUT_MS)
  );

  const network = (async () => {
    try {
      const res = await fetch(request);
      // Update cached index.html opportunistically if same-origin
      if (res && res.ok && new URL(request.url).origin === self.location.origin) {
        cache.put(indexUrl, res.clone()).catch(() => {});
      }
      return res;
    } catch (e) {
      return undefined;
    }
  })();

  const winner = await Promise.race([network, timeout]);

  if (winner) return winner;

  // Network failed or timed out: serve cached index
  const cached = await cache.match(indexUrl);
  if (cached) return cached;

  // Last resort
  return new Response('<!doctype html><title>Offline</title><h1>Offline</h1>', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status: 503,
    statusText: 'Service Unavailable'
  });
}

// Cache-first for static same-origin assets with graceful fallbacks
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const res = await fetch(request);
    // Only cache successful same-origin responses (avoid CORS issues)
    if (res && res.ok) {
      try { await cache.put(request, res.clone()); } catch (e) { /* ignore */ }
    }
    return res;
  } catch (e) {
    // Offline fallback for images -> apple-touch icon if present
    if (isImageRequest(request)) {
      const fallback = await cache.match(urlFromBase('apple-touch-icon-180.png'));
      if (fallback) return fallback;
    }
    return new Response(null, { status: 503, statusText: 'Service Unavailable' });
  }
}

// Support messages from the page (e.g., trigger SKIP_WAITING on update)
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
