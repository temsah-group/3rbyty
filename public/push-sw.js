/* 3arabity push notifications: shows what Firebase delivers and opens it on a tap. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const notification = payload.notification || {};
  const data = payload.data || {};
  event.waitUntil(
    (async () => {
      // Open tabs refresh their unread count.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      windows.forEach((client) => client.postMessage({ type: 'push', data }));
      await self.registration.showNotification(notification.title || 'عربيتي', {
        body: notification.body || '',
        icon: '/icon-192.png',
        badge: '/icon-72.png',
        dir: 'auto',
        tag: data.notificationId || undefined,
        data,
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // Where the inbox page would go for the same notification.
  const path = data.requestId
    ? `/requests/${data.requestId}`
    : data.kind === 'LISTING' && data.partId
      ? '/account/parts'
      : data.partId
        ? `/parts/${data.partId}`
        : data.kind === 'SHOP'
          ? '/account/shop'
          : data.kind === 'ACCOUNT'
            ? '/account'
            : '/notifications';
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ('navigate' in client) await client.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
