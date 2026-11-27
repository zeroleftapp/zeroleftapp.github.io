// ===== Service worker: offline support and reliable updates =====
// The browser runs this file in the background, between the app and the
// internet. It keeps a copy of the app's files for offline use.
//
// How updates reach users:
// 1. VERSION changes with every release (run ./bump-version.sh before
//    publishing). Any change to this file makes the browser install the
//    new service worker, which downloads a fresh copy of every file.
// 2. When online, files always come from the network, and the browser's
//    own short-term cache is skipped ("no-cache"), so index.html and the
//    rest are never stale. The saved copy is only used offline.
// 3. pwa.js reloads the app the next time it's opened after an update.

const VERSION = "2026-11-27-1256";
const CACHE = "budget-app-" + VERSION;

// Everything the app needs to start without internet.
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "csv.js",
  "importer.js",
  "app.js",
  "settings.js",
  "pwa.js",
  "privacy.html",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
];

// How long to wait for the network before using the saved copy
// (so a very slow connection doesn't leave the app hanging).
const NETWORK_TIMEOUT_MS = 4000;

// New version installed: download fresh copies of all files,
// skipping the browser's HTTP cache ("reload").
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

// New version active: delete older versions' copies and take over.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("budget-app-") && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch from the network, but give up after a few seconds.
function fetchFresh(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  return fetch(request, { cache: "no-cache", signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// Every request from the app goes through here: network first, then cache.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Only handle our own files (GET requests on the same site)
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    fetchFresh(request)
      .then((response) => {
        // Online: keep this fresh copy for when we're offline
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        // Offline (or too slow): use the saved copy. Pages fall back to index.html.
        caches.match(request, { ignoreSearch: true }).then((cached) =>
          cached || (request.mode === "navigate" ? caches.match("index.html") : Response.error())
        )
      )
  );
});
