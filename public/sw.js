// Lily Memo offline service worker.
//
// Strategy:
//   - Hashed Next.js assets (/_next/static/*, /_next/image, fonts, media):
//     cache-first — they never change for a given URL, so once cached
//     they're served instantly and work offline forever.
//   - HTML navigations: network-first with a fallback to the cached
//     shell ("/"). This keeps users on the latest deploy when online
//     and still loads the app cold when offline.
//   - Other same-origin GETs (manifest, logo, pdf worker, public files):
//     stale-while-revalidate so we always have a usable copy locally.
//   - /api/* and POST/PUT/etc: bypass the cache entirely. The only API
//     route (/api/pdf-proxy) is large and URL-specific; caching it
//     would bloat storage with no real win.

const VERSION = 'lily-memo-v3';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/logo.png',
  '/pdf.worker.min.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(
      PRECACHE_URLS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok) await cache.put(url, res);
        } catch {
          // best-effort; missing entries fall back to network on demand
        }
      })
    );
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => !k.startsWith(VERSION))
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

const isHashedStatic = (url) =>
  url.pathname.startsWith('/_next/static/') ||
  url.pathname.startsWith('/_next/image') ||
  /\.(?:woff2?|ttf|otf|eot)$/i.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API routes — they're either dynamic data or large
  // proxied binaries that only make sense online.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation: network-first with shell fallback.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('/', res.clone()).catch(() => {});
        return res;
      } catch {
        const cached = await caches.match('/', { ignoreSearch: true });
        if (cached) return cached;
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>オフライン</title>' +
          '<body style="font-family:sans-serif;padding:24px">オフラインです。' +
          'もう一度接続して読み込み直してください。</body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
        );
      }
    })());
    return;
  }

  // Hashed assets: cache-first, fall back to network and persist.
  if (isHashedStatic(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })());
    return;
  }

  // Everything else (public files, etc.): stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const networkPromise = fetch(req)
      .then((res) => {
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      })
      .catch(() => undefined);
    return cached || (await networkPromise) || new Response('', { status: 504 });
  })());
});
