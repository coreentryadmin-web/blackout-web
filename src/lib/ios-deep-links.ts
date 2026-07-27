import { isIosAppShell } from "@/lib/ios-app-shell";

// Deep-link handler for the Capacitor iOS shell.
//
// When a user taps a push notification, the OS opens the app and — because
// `@capacitor/app` is installed in the iOS shell — fires `appUrlOpen` with
// the URL that was attached to the notification (or a universal link that
// launched the app). We route them to the correct in-app path via Next.js
// client-side navigation so no full reload happens.
//
// Two shapes we accept in the appUrlOpen URL:
//   1. FULL URL — https://blackouttrades.com/nighthawk?ed=abc  → navigate to path.
//   2. CUSTOM SCHEME — blackout://signals/spx-2026-07-27-a     → normalize
//      the path portion and navigate to it.
//
// This module is safe to import from anywhere: if we're not in the iOS shell,
// or the App plugin isn't loaded, `initIosDeepLinks()` returns a no-op cleanup.

type UrlOpenEvent = { url: string };

type CapApp = {
  addListener: (
    event: "appUrlOpen",
    handler: (event: UrlOpenEvent) => void
  ) => Promise<{ remove: () => Promise<void> }>;
};

function appPlugin(): CapApp | undefined {
  if (typeof window === "undefined") return undefined;
  const cap = (window as Window & { Capacitor?: { Plugins?: { App?: CapApp } } }).Capacitor;
  return cap?.Plugins?.App;
}

/** Public routes an appUrlOpen is permitted to navigate to. Guarded so a
 *  malicious universal link can't be used to redirect the app to an
 *  arbitrary path. `/admin` and `/dev/*` are DELIBERATELY excluded — those
 *  routes are already server-side gated on admin role, but a deep-link that
 *  bounces the user there before the tier check is unnecessary UX noise
 *  (and one less surface if the server gate ever regresses). */
const ROUTE_ALLOWLIST = [
  "/dashboard",
  "/flows",
  "/heatmap",
  "/terminal",
  "/nighthawk",
  "/vector",
  "/account",
  "/faq",
  "/learn",
  "/upgrade",
  "/privacy",
];

function isAllowedPath(path: string): boolean {
  // Allow "/", exact matches, and prefix matches (for /learn/getting-started etc.).
  if (path === "/" || path === "") return false;
  return ROUTE_ALLOWLIST.some((allowed) => path === allowed || path.startsWith(allowed + "/"));
}

/** Extract a routable path from either a full BlackOut URL or a custom
 *  scheme URL. Returns null if the URL doesn't resolve to an allowed path. */
export function pathFromDeepLink(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    // Full URL — only accept our host to prevent open-redirect via a
    // crafted appUrlOpen (though iOS enforces universal-link domains, an
    // in-app deep-link handler that trusts any URL is a common footgun).
    if (u.protocol === "https:" || u.protocol === "http:") {
      const host = u.hostname.toLowerCase();
      if (host !== "blackouttrades.com" && !host.endsWith(".blackouttrades.com")) return null;
      const path = u.pathname + u.search;
      const bare = u.pathname;
      return isAllowedPath(bare) ? path : null;
    }
    // Custom scheme — blackout://path/segment?query
    // URL parses `blackout://foo/bar` as hostname=foo, pathname=/bar; we
    // want the whole thing treated as a path, so reassemble.
    if (u.protocol === "blackout:") {
      const path = "/" + (u.hostname || "") + u.pathname;
      const normalizedBare = path.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
      return isAllowedPath(normalizedBare) ? path + u.search : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Install the appUrlOpen listener. `navigate` is injected so callers can
 * pass Next.js's `router.push` (client-side) — testing this in isolation
 * doesn't need next/navigation.
 *
 * Returns a cleanup that removes the listener. Safe to call unconditionally;
 * returns a no-op cleanup outside the iOS shell.
 */
export function initIosDeepLinks(navigate: (path: string) => void): () => void {
  if (!isIosAppShell()) return () => {};
  const app = appPlugin();
  if (!app) return () => {};

  let handle: { remove: () => Promise<void> } | undefined;

  void app
    .addListener("appUrlOpen", (event) => {
      const path = pathFromDeepLink(event.url);
      if (path) navigate(path);
    })
    .then((h) => {
      handle = h;
    })
    .catch(() => {
      /* plugin registration can fail if the app version is very old — ignore */
    });

  return () => {
    void handle?.remove().catch(() => {});
  };
}
