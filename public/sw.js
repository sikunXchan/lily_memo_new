// Self-destructing service worker.
//
// The previous @ducanh2912/next-pwa service worker is still installed
// on users' devices and intercepts every request with a stale cache,
// which prevents new deploys from ever loading — they see
// "This page couldn't load" on iOS Safari.
//
// Browsers always fetch /sw.js from the network (bypassing any
// installed SW) to check for updates, so dropping this file at /sw.js
// reliably reaches stuck clients. On activation it wipes every cache,
// unregisters itself, and reloads open windows so the next request
// goes straight to the network with no SW in the way.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const c of clients) {
        try { c.navigate(c.url); } catch {}
      }
    } catch {}
  })());
});

// No fetch handler — without respondWith(), every request falls
// through to the network as if no SW were installed.
