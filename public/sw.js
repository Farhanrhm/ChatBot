const CACHE_NAME = "sobatsteam-shell-v1";

const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/wishlistCore.js",
  "/comparisonCore.js",
  "/manifest.json",
  "/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn("Gagal pre-cache aset PWA:", err);
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Strict Network-Only untuk endpoint API SobatSteam
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 2. Hanya tangani request HTTP GET
  if (event.request.method !== "GET") {
    return;
  }

  // 3. Stale-While-Revalidate untuk aset statis UI
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === "basic"
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Gagal jaringan (offline) - gunakan cachedResponse jika ada
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
