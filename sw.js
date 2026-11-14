/**
 * Campus Unfolded — Service Worker
 *
 * Strategy:
 * - HTML (navigation): network-first with 3s timeout → cache fallback → offline page
 * - App shell (JS/CSS): stale-while-revalidate (fast load + background update)
 * - Images/fonts: cache-first
 * - Firebase / Google / YouTube / admin: never cached, always network
 * - POST / non-GET: never cached
 */

// ============================================
// CONFIG
// ============================================

// Bump these on every deploy. Or inject __BUILD__ at build time.
const VERSION = 'v2.3.7';
const STATIC_CACHE = `cu-static-${VERSION}`;
const RUNTIME_CACHE = `cu-runtime-${VERSION}`;
const IMAGE_CACHE = `cu-images-${VERSION}`;

const NETWORK_TIMEOUT_MS = 3000;

// Assets that MUST be available offline (only public, non-sensitive)
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/dashboard.html',
    '/scrapbook.html',
    '/library.html',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    '/favicon.png'
];

// ============================================
// HELPERS
// ============================================

function isFirebaseOrGoogle(url) {
  const host = new URL(url).hostname;
  return (
    host.includes('firebase') ||        // *.firebaseapp.com, *.firebaseio.com, etc.
    host.includes('googleapis.com') ||  // *.googleapis.com (auth, firestore, storage, appcheck, install)
    host.includes('gstatic.com') ||     // firebase SDKs, fonts loader
    host.includes('google.com') ||      // accounts.google.com, apis.google.com (Google Sign-In)
    host.includes('youtube.com') ||     // iframe player
    host.includes('ytimg.com')          // thumbnails
  );
}

function isAdminPage(url) {
  return new URL(url).pathname.startsWith('/admin');
}

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

function isImageRequest(request) {
  return request.destination === 'image';
}

function isStyleOrScript(request) {
  return request.destination === 'style' ||
         request.destination === 'script' ||
         request.destination === 'worker';
}

function timeout(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('network-timeout')), ms)
  );
}

async function cacheFirst(cacheName, request) {
  const cached = await caches.match(request, { cacheName });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Image fallback — return the app icon or a 404
    if (isImageRequest(request)) {
      const fallback = await caches.match('/icon-192.png');
      if (fallback) return fallback;
    }
    return new Response('', { status: 404, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  // Return cached immediately if available; update in background
  if (cached) {
    networkPromise; // fire and forget
    return cached;
  }
  const fresh = await networkPromise;
  if (fresh) return fresh;
  return new Response('', { status: 504, statusText: 'Offline' });
}

async function networkFirstNavigation(request) {
  try {
    const response = await Promise.race([
      fetch(request),
      timeout(NETWORK_TIMEOUT_MS)
    ]);

    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
      return response;
    }
    throw new Error('bad-response');
  } catch (_) {
    // Fallback: exact cache, then app shell
    const cached = await caches.match(request);
    if (cached) return cached;

    // Only serve index.html for `/` or hash-route style paths
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const root = await caches.match('/index.html');
      if (root) return root;
    }

    // Anything else → offline page
    return offlinePage();
  }
}

async function offlinePage() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>You're offline — Campus Unfolded</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    background:#DFDDD3;color:#233130;
    display:flex;align-items:center;justify-content:center;
    padding:2rem;text-align:center;
  }
  .card{
    max-width:420px;padding:2rem;border-radius:24px;
    background:#fff;box-shadow:0 20px 40px rgba(0,0,0,0.15);
  }
  h1{font-size:1.5rem;margin-bottom:.5rem}
  p{color:#85937D;line-height:1.6;margin-bottom:1.5rem}
  button{
    padding:12px 28px;border:none;border-radius:14px;
    background:#5a745f;color:#fff;font-weight:600;font-size:.95rem;
    cursor:pointer;font-family:inherit;
  }
  button:hover{background:#4a6353}
  @media(prefers-color-scheme:dark){
    body{background:#0d1117;color:#c9d1d9}
    .card{background:#161b22}
    p{color:#8b949e}
    button{background:#58a6ff;color:#0d1117}
    button:hover{background:#1f6feb}
  }
</style>
</head>
<body>
  <div class="card">
    <h1>You're offline</h1>
    <p>Campus Unfolded needs an internet connection. Check your network and try again.</p>
    <button onclick="location.reload()">Retry</button>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ============================================
// INSTALL
// ============================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);

      // allSettled: one 404 shouldn't block install
      const results = await Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Failed to cache:', url, err.message);
          })
        )
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed) console.warn(`[SW] ${failed} static asset(s) failed to cache`);

      await self.skipWaiting();
    })()
  );
});

// ============================================
// ACTIVATE — clean old caches
// ============================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const validCaches = [STATIC_CACHE, RUNTIME_CACHE, IMAGE_CACHE];
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => {
          if (!validCaches.includes(name)) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
      await self.clients.claim();
    })()
  );
});

// ============================================
// FETCH
// ============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET requests
  if (request.method !== 'GET') return;

  // Never touch Firebase / Google / YouTube / admin
  if (isFirebaseOrGoogle(request.url)) return;
  if (isAdminPage(request.url)) return;

  // HTML navigation → network-first
  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Images → cache-first
  if (isImageRequest(request)) {
    event.respondWith(cacheFirst(IMAGE_CACHE, request));
    return;
  }

  // JS / CSS / fonts / worker → stale-while-revalidate (fast + auto-updates)
  if (isStyleOrScript(request) ||
      request.destination === 'font' ||
      request.destination === 'manifest') {
    event.respondWith(staleWhileRevalidate(RUNTIME_CACHE, request));
    return;
  }

  // Everything else → network with cache fallback (no store)
  event.respondWith(
    fetch(request).catch(() =>
      new Response('', { status: 504, statusText: 'Offline' })
    )
  );
});

// ============================================
// MESSAGE — update prompt support
// ============================================
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_ALL_CACHES') {
    caches.keys().then((names) => names.forEach((n) => caches.delete(n)));
  }
});
