/* =====================================================
   🌰 도토리 상점 v5 — Service Worker
   ===================================================== */
const CACHE_NAME = 'acorn-shop-v30';
const CACHE_URLS = [
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/supabase-client.js',
  './js/state.js',
  './js/utils.js',
  './js/helpers.js',
  './js/ui.js',
  './js/auth.js',
  './js/shop.js',
  './js/gacha.js',
  './js/quest.js',
  './js/mypage.js',
  './js/notification.js',
  './js/event.js',
  './js/recycle.js',
  './js/admin.js',
  './js/minigame.js',
  './js/minigame_catch.js',
  './js/minigame_2048.js',
  './js/minigame_roulette.js',
  './js/squirrel.js',
  './js/expedition.js',
  './js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(CACHE_URLS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.startsWith('chrome-extension')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
self.addEventListener('push', e => {
  if (!e.data) return;
  let d = {};
  try { d = e.data.json(); } catch { d = { title: '도토리 상점', body: e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || '도토리 상점 🌰', {
    body: d.body, icon: './icons/icon-192x192.png', badge: './icons/icon-72x72.png',
    tag: d.tag || 'acorn', vibrate: [200, 100, 200],
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(cs => {
    for (const c of cs) if ('focus' in c) return c.focus();
    if (clients.openWindow) return clients.openWindow('./');
  }));
});
