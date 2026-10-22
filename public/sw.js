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
  // 1. Abaikan request non-HTTP/HTTPS (misalnya skema chrome-extension://)
  if (!event.request.url.startsWith("http://") && !event.request.url.startsWith("https://")) {
    return;
  }

  const url = new URL(event.request.url);

  // 2. Strict Network-Only untuk endpoint API SobatSteam
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 3. Hanya tangani aset dari origin aplikasi sendiri (same-origin UI shell)
  // Biarkan browser memuat aset pihak ketiga (seperti Google Fonts dan Steam CDN) secara native
  if (url.origin !== self.location.origin) {
    return;
  }

  // 4. Hanya tangani request HTTP GET
  if (event.request.method !== "GET") {
    return;
  }

  // 4. Stale-While-Revalidate untuk aset statis UI dengan fallback Response yang aman
  event.respondWith(
    caches
      .match(event.request)
      .then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (
              networkResponse &&
              networkResponse.status === 200 &&
              networkResponse.type === "basic" &&
              (event.request.url.startsWith("http://") || event.request.url.startsWith("https://"))
            ) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache).catch(() => {});
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Gagal jaringan (offline) - gunakan cachedResponse jika tersedia
            if (cachedResponse) {
              return cachedResponse;
            }
            // Fallback navigasi offline ke shell aplikasi utama
            if (event.request.headers.get("accept")?.includes("text/html")) {
              return caches.match("/index.html").then((htmlMatch) => {
                return (
                  htmlMatch ||
                  new Response("Offline - aset tidak tersedia", {
                    status: 503,
                    statusText: "Service Unavailable",
                    headers: new Headers({ "Content-Type": "text/plain; charset=utf-8" }),
                  })
                );
              });
            }
            // Fallback respons error HTTP terdefinisi untuk mencegah TypeError Response conversion
            return new Response("Offline - aset tidak tersedia", {
              status: 503,
              statusText: "Service Unavailable",
              headers: new Headers({ "Content-Type": "text/plain; charset=utf-8" }),
            });
          });

        return cachedResponse || fetchPromise;
      })
      .catch(() => {
        // Fallback menyeluruh jika caches.match mengalami kegagalan
        return new Response("Network error", {
          status: 408,
          statusText: "Request Timeout",
          headers: new Headers({ "Content-Type": "text/plain; charset=utf-8" }),
        });
      })
  );
});

