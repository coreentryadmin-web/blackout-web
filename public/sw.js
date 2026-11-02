// BlackOut Trades — minimal PWA service worker.
// Goal: installability + an offline app-shell fallback. Intentionally conservative:
// it NEVER caches authenticated API/HTML responses (no stale trade data, no leaking
// one user's cached pages to another on a shared device). Money-path data always
// hits the network.

const CACHE = "blackout-shell-v2";
// Static, public, non-personalized assets only.
const SHELL = ["/offline", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Same-origin only. Never touch API routes or cross-origin (Clerk, TradingView, CDNs).
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/") && url.pathname.includes("/data/")) return;

  // Navigations: network-first, fall back to the offline shell when truly offline.
  // We do NOT cache the navigation response (it may be a personalized authed page).
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline")));
    return;
  }

  // Static build assets (immutable, public): cache-first.
  if (url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
      )
    );
  }
});

// --- Web Push (inert until a push is actually delivered) ---
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "BlackOut Trades", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "BlackOut Trades";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "blackout",
    data: { url: data.url || "/dashboard" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Resolve a push payload's `url` field to a safe, same-origin path+search+hash,
 * or `fallback` when it is not one.
 *
 * WHY A STRING-PREFIX CHECK IS NOT ENOUGH. The previous guard —
 * `raw.startsWith("/") && !raw.startsWith("//")` — only rejects an EXPLICIT
 * protocol-relative string like "//evil.com". It does not reject "/\evil.com" or
 * "/\\evil.com": the WHATWG URL parser treats "\" exactly like "/" for a special
 * scheme (http/https) while parsing a relative reference, so a leading "/"
 * immediately followed by a "\" is ALSO read as the two-slash-like prefix that
 * starts a network-path reference and resolves to a DIFFERENT origin —
 *   new URL("/\\evil.com/x", "https://blackouttrades.com/").origin
 *     === "https://evil.com"
 * — which satisfies `startsWith("/") && !startsWith("//")` while still taking the
 * user to `evil.com` when they tap the notification. Parsing with `URL` and
 * comparing the RESOLVED `.origin` closes every variant (single backslash,
 * double backslash, a bare absolute `https://...` URL) at once, instead of
 * pattern-matching the open-ended set of strings that normalize to a
 * cross-origin reference. Regression-tested from `src/lib/push/sw.test.ts`,
 * which loads THIS file (not a copy) into a sandboxed `vm` context — this is a
 * classic, unbundled script with no `import`/`export`, so there is nothing to
 * import from a normal test module; executing the real source is the only way
 * to test it without a second implementation that can drift from this one.
 */
function resolveNotificationTarget(raw, origin, fallback) {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    var resolved = new URL(raw, origin);
    if (resolved.origin !== origin) return fallback;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch (_) {
    return fallback;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  var raw = (event.notification.data && event.notification.data.url) || "/dashboard";
  var target = resolveNotificationTarget(raw, self.location.origin, "/dashboard");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(target) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
