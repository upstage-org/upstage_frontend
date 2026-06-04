// This Service Worker used to do nothing but pass every fetch straight
// through (no caching). It added console noise ("Failed to fetch", update
// churn) and complicated cache-busting for zero benefit, so it has been
// retired. The body below unregisters the worker so any browser that still
// has the old SW installed drops it on the next visit; new visitors never
// register one (see src/main.ts). Once no client has the old SW, this file
// can be deleted entirely.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.registration
      .unregister()
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((client) => client.navigate(client.url))),
  );
});
