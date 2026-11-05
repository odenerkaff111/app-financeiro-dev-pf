self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* Minhas Financas - service worker de notificacoes. Nao faz cache de dados financeiros. */
const DEFAULT_URL = '/registros';
const ICON = '/icons/icon-192.png';

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === 'string' ? payload.title : 'Minhas Financas';
  const body = typeof payload.body === 'string' ? payload.body : 'Confira suas movimentacoes financeiras.';
  const url = typeof payload.url === 'string' && payload.url.startsWith('/') ? payload.url : DEFAULT_URL;
  const tag = typeof payload.tag === 'string' ? payload.tag : 'finance-reminder';
  const badgeCount = Number.isInteger(payload.badge) && payload.badge > 0 ? payload.badge : 1;

  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      icon: ICON,
      badge: ICON,
      tag,
      renotify: true,
      data: { url },
    });
    if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
      await self.navigator.setAppBadge(badgeCount).catch(() => undefined);
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const relative = event.notification?.data?.url;
  const target = new URL(typeof relative === 'string' ? relative : DEFAULT_URL, self.location.origin).href;
  event.waitUntil((async () => {
    if (self.navigator && typeof self.navigator.clearAppBadge === 'function') {
      await self.navigator.clearAppBadge().catch(() => undefined);
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('navigate' in client) await client.navigate(target).catch(() => undefined);
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
