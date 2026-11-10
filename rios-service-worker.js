'use strict';

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data?.text?.() || 'Your routine reminder is ready.' }; }
  const options = {
    body: payload.body || 'Your routine reminder is ready.',
    icon: payload.icon || '/hios-app-icon.svg',
    badge: payload.badge || '/hios-app-icon.svg',
    tag: payload.tag || `rios-routine-${payload.eventId || 'reminder'}`,
    renotify: false,
    data: { url: payload.url || '/r-ios.html', eventId: payload.eventId || null },
    timestamp: payload.timestamp || Date.now()
  };
  event.waitUntil(self.registration.showNotification(payload.title || 'R-IOS — Routine reminder', options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/r-ios.html', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if (!new URL(client.url).pathname.endsWith('/r-ios.html')) continue;
      if ('navigate' in client) await client.navigate(url);
      return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
