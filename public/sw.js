const CACHE_PREFIX = 'gpt-stt-';

async function clearAppCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)));
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(clearAppCaches());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    clearAppCaches()
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url))))
  );
});
