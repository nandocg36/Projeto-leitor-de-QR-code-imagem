const CACHE = "qr-image-reader-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./vendor/jsQR.min.js",
  "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.mjs",
  "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.mjs",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS).catch(function () {
        return cache.addAll(
          ASSETS.filter(function (u) {
            return !u.startsWith("http");
          })
        );
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) {
            return k !== CACHE;
          })
          .map(function (k) {
            return caches.delete(k);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") {
    return;
  }
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname.endsWith("/sw.js")) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then(function (res) {
        if (!res || res.status !== 200 || res.type !== "basic") {
          return res;
        }
        const copy = res.clone();
        caches.open(CACHE).then(function (cache) {
          cache.put(event.request, copy);
        });
        return res;
      });
    })
  );
});
