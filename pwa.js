// ===== Service worker setup and app updates =====
// Starts the service worker (sw.js) and makes sure a new version is used
// the next time the app is opened.
//
// A Home Screen app on a phone often isn't really restarted: it's just
// brought back from the background. So we also check for updates whenever
// the app comes back into view, and reload it then if a new version arrived.

(function () {
  // Browsers only allow service workers on a real web address (http/https),
  // not when opening the file directly.
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;

  let updateReady = false;
  const hadController = !!navigator.serviceWorker.controller;

  // A new version took over while the app was open. Don't interrupt the
  // user now; reload next time the app is opened / brought back.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) updateReady = true; // (first install isn't an "update")
  });

  navigator.serviceWorker
    // updateViaCache "none": always check sw.js itself from the network
    .register("sw.js", { updateViaCache: "none" })
    .then((registration) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          // Leaving the app: a good moment to look for a new version
          registration.update().catch(() => {});
        } else if (updateReady && !document.querySelector("dialog[open]")) {
          // Back in the app and a new version is ready: load it.
          // (Data is saved on every change, so nothing is lost.)
          location.reload();
        }
      });
      // Also check once on every start
      registration.update().catch(() => {});
    })
    .catch((e) => console.warn("Service worker failed", e));

  // Show the running version in Settings, e.g. "App version 2026-11-25-1".
  if ("caches" in window) {
    caches.keys().then((keys) => {
      const key = keys.filter((k) => k.startsWith("budget-app-")).sort().pop();
      const el = document.getElementById("app-version");
      if (key && el) el.textContent = "App version " + key.replace("budget-app-", "");
    });
  }
})();
