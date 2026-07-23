/*
 * AGBR Opportunity Tool — service worker
 *
 * Caching policy is deliberately conservative, because the failure mode that
 * matters here is a rep working last month's gap list without knowing it.
 *
 *   - The HTML shell is network-first. Online, they always get current data.
 *     Offline, they get the last copy that loaded, so the tool still opens in
 *     a store with no signal.
 *   - /api/* is never cached. Outcome marks must reach the server or visibly
 *     fail; a cached success would be a lie.
 *   - Icons and the manifest are cache-first. They don't change.
 */

const VERSION = "agbr-v4.1.0";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

const PRECACHE = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve target data from cache.
  if (url.pathname.startsWith("/api/")) return;

  const isShell =
    request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname === "/index.html";

  if (isShell) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match("/index.html"))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(ASSETS).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
