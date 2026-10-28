self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch { message = {}; }
  const title = message.title || 'Alerta Tram';
  event.waitUntil(self.registration.showNotification(title, {
    body: message.body || 'Hay una nueva actualización en tu trayecto.',
    icon: message.icon || '/favicon.png',
    badge: '/favicon.png',
    tag: message.tag || 'alerta-tram-update',
    renotify: false,
    data: { url: message.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const targetUrl = event.notification.data?.url || '/';
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => 'focus' in client);
    if (existing) {
      await existing.focus();
      if ('navigate' in existing) await existing.navigate(targetUrl);
      return;
    }
    await self.clients.openWindow(targetUrl);
  })());
});
