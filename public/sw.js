/* eslint-disable no-console */
/**
 * Voyagr service worker.
 *
 * Hand-written rather than generated, because the foundation needs exactly three
 * things and nothing more:
 *
 *  1. An offline fallback, so closing the laptop lid does not produce a browser
 *     error page.
 *  2. A cache strategy that cannot serve a stale price. Navigations and API
 *     requests are network-first; only genuinely static assets are cache-first.
 *     Showing a cached flight price would violate the product's own rule that
 *     every displayed price carries a timestamp.
 *  3. Push event handling, which is the Web Push foundation (specification
 *     section 18). Delivery is wired up; the alerting logic that decides *when*
 *     to send belongs to the deal detector and does not exist yet.
 *
 * A Workbox or Serwist build step can replace this later. It is plain JS today
 * so there is no extra build plumbing to reason about.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `voyagr-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `voyagr-assets-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline';

/** Precached so the offline page is available on the very first disconnection. */
const SHELL_URLS = [OFFLINE_URL];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_URLS);
      // Take over as soon as possible; the app shell has no legacy state.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions so a deploy cannot leave a client
      // permanently pinned to old assets.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('voyagr-') && key !== SHELL_CACHE && key !== ASSET_CACHE)
          .map((key) => caches.delete(key)),
      );

      await self.clients.claim();
    })(),
  );
});

/** Static build output is content-hashed, so it is safe to serve from cache. */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never interfere with anything that changes state.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin requests are left entirely alone.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else, including API responses, goes to the network. A stale
  // price is worse than no price.
});

/** Network-first with an offline fallback. Never serves a cached HTML page. */
async function handleNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return (
      offline ??
      new Response('You are offline.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);

  // Only cache a genuine success; an opaque or error response must not stick.
  if (response.ok && response.type === 'basic') {
    cache.put(request, response.clone());
  }

  return response;
}

// --- Web Push --------------------------------------------------------------

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Voyagr', body: event.data.text(), url: '/' };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Voyagr', {
      body: payload.body ?? '',
      // A tag collapses repeat alerts for the same watch, which is the
      // notification-fatigue mitigation from specification section 18.
      tag: payload.tag,
      data: { url: payload.url ?? '/', ...payload.data },
      badge: '/icons/icon-192.png',
      icon: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Focus an existing tab rather than opening a duplicate.
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }

      return self.clients.openWindow(targetUrl);
    })(),
  );
});
