// ===== Service worker: makes the app work offline =====
// The browser runs this file in the background. It keeps a copy of the
// app's files, and when there's no internet it serves that copy instead.
//
// Strategy "network first": when online, always fetch the newest files
// (and refresh the saved copy); when offline, use the saved copy.
// So after you change the app, a normal page reload shows the change.

const CACHE = "budget-app-v1";

// Everything the app needs to start without internet.
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "csv.js",
  "importer.js",
  "app.js",
  "settings.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
];

// First install: save all files.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

// New version activated: remove caches from older versions.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Every request from the app goes through here.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Only handle our own files (GET requests on the same site)
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Online: keep a fresh copy for next time we're offline
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        // Offline: use the saved copy. Page loads fall back to index.html.
        caches.match(request, { ignoreSearch: true }).then((cached) =>
          cached || (request.mode === "navigate" ? caches.match("index.html") : undefined)
        )
      )
  );
});
