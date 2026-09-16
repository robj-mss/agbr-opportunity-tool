/* AGBR Opportunity Tool — service worker
 *
 * Why this file matters: the previous worker served the app shell from cache
 * first, so a freshly deployed index.html could sit behind an old cached copy
 * indefinitely (that is why a newly added line did not appear after deploy).
 *
 * Strategy:
 *   - navigations / HTML : network first, cache only as an offline fallback
 *   - /api/*             : never cached
 *   - other static files : cache first, refreshed in the background
 *
 * Bump VERSION on any deploy where you want every client's cache dropped.
 */
var VERSION = "agbr-v5.4.0";
var STATIC  = VERSION + "-static";
var SHELL   = "/index.html";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== STATIC) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;   // live data, never cached

  var accept = req.headers.get("accept") || "";
  var isPage = req.mode === "navigate" || accept.indexOf("text/html") !== -1;

  if (isPage) {
    e.respondWith(
      fetch(req, { cache: "no-store" }).then(function (fresh) {
        var copy = fresh.clone();
        caches.open(STATIC).then(function (c) { c.put(SHELL, copy); });
        return fresh;
      }).catch(function () {
        return caches.open(STATIC).then(function (c) {
          return c.match(req).then(function (hit) {
            return hit || c.match(SHELL) || Response.error();
          });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.open(STATIC).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (r) {
          if (r && r.status === 200 && r.type === "basic") c.put(req, r.clone());
          return r;
        }).catch(function () { return null; });
        return hit || net.then(function (r) { return r || Response.error(); });
      });
    })
  );
});
