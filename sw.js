/* Yahtzee service worker.
 *
 * Bump VERSION on every release. The cache name is derived from it, so a new
 * version installs into a fresh cache and the previous one is deleted when the
 * new worker activates.
 *
 * Strategy:
 *   - the page itself is network-first, so a deploy lands as soon as the phone
 *     is online, with the cached copy as the offline fallback;
 *   - everything else (icons, manifest, the pinned CDN modules) is immutable
 *     for a given version, so it is served cache-first.
 */
const VERSION = '4.6';
const CACHE = 'yahtzee-' + VERSION;

// Same-origin files the app cannot start without.
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png'
];

// Pinned third-party modules. Cached opportunistically: if the CDN is
// unreachable while installing, the install should still succeed.
const VENDOR = [
  'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.core.js',
  'https://cdn.jsdelivr.net/npm/postprocessing@6.39.5/build/index.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    await Promise.all(VENDOR.map(function (u) {
      return c.add(new Request(u, { mode: 'cors' })).catch(function () { /* offline install is fine */ });
    }));
    // Take over straight away rather than waiting for every tab to close —
    // a Home Screen app is rarely "closed", so otherwise an update can sit
    // waiting indefinitely.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.map(function (k) {
      return (k.indexOf('yahtzee-') === 0 && k !== CACHE) ? caches.delete(k) : Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // The page: network-first so updates are picked up without any cache dance.
  if (req.mode === 'navigate' ||
      (url.origin === self.location.origin && url.pathname.endsWith('.html'))) {
    e.respondWith((async function () {
      try {
        const net = await fetch(req);
        if (net && net.ok) {
          const c = await caches.open(CACHE);
          c.put('./index.html', net.clone());
        }
        return net;
      } catch (err) {
        const cached = await caches.match('./index.html');
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Assets: cache-first, filling in on a miss.
  e.respondWith((async function () {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const net = await fetch(req);
      const cacheable = net && net.ok &&
        (url.origin === self.location.origin || VENDOR.indexOf(req.url) >= 0);
      if (cacheable) {
        const c = await caches.open(CACHE);
        c.put(req, net.clone());
      }
      return net;
    } catch (err) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
