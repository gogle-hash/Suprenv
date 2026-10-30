/* SUPRENV · service worker
   - Hace la app instalable y rápida de abrir (caché del cascarón).
   - Recibe los avisos push aunque la app esté cerrada y los muestra como notificación.
   - Al tocar una notificación abre (o enfoca) la app. */
'use strict';

const VERSION = 'suprenv-v2';
const CDN_CACHE = 'suprenv-cdn-v1';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'badge-96.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))   // un archivo que falle ya no tumba a los demás
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== CDN_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pantalla principal: primero la red (siempre la versión nueva); sin internet, la copia guardada.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('index.html', copy)); }
          return res;
        })
        .catch(() => caches.match('index.html', { ignoreSearch: true }).then((r) => r || caches.match('./')))
    );
    return;
  }

  // Archivos propios (iconos, manifiesto): primero la copia guardada.
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }

  // Librerías de CDN (supabase-js): se guardan para que la app abra aunque el CDN tarde.
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'unpkg.com' || url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(
      caches.open(CDN_CACHE).then((cache) =>
        cache.match(req).then((hit) => {
          const net = fetch(req)
            .then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; })
            .catch(() => hit);
          return hit || net;
        })
      )
    );
  }
  // Todo lo demás (Supabase, imágenes de usuarios, etc.) va directo a la red.
});

// ---------------------------------- Avisos push ----------------------------------
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (e) { d = { title: 'SUPRENV', body: event.data ? event.data.text() : '' }; }

  const title = d.title || 'SUPRENV';
  const urgent = /oferta|operaci[oó]n/i.test(title);   // las ofertas vibran más y no se esconden solas
  const isIOS = /iPad|iPhone|iPod/.test(self.navigator.userAgent || '');

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Si el usuario está usando la app en este momento, no se duplica el aviso (la app ya se lo muestra).
    // En iPhone siempre se muestra: Safari exige una notificación por cada push.
    if (!isIOS && wins.some((w) => w.visibilityState === 'visible' && w.focused)) {
      wins.forEach((w) => w.postMessage({ type: 'push', payload: d }));
      return;
    }
    await self.registration.showNotification(title, {
      body: d.body || '',
      tag: d.tag || 'suprenv',
      renotify: true,
      icon: 'icon-192.png',
      badge: 'badge-96.png',
      vibrate: urgent ? [300, 120, 300, 120, 500] : [200, 100, 200],
      requireInteraction: urgent,
      timestamp: Date.now(),
      data: { url: d.url || './' }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
