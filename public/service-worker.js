self.addEventListener('install', (event) => {
  self.skipWaiting(); // Activate the new service worker immediately
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim()); // Take control of the page immediately
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request)); // Basic fetch handling
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CHECK_UPDATE') {
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({ type: 'VERSION_UPDATE', version: '1.0.2' });
      });
    });
  }
});
