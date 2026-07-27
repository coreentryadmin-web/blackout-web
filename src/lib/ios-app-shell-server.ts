import { headers } from "next/headers";

/**
 * Server-side counterpart to `isIosAppShell()` (client-only, reads
 * `html.ios-app`). Reads the request `User-Agent` header and returns true when
 * the BlackOut Capacitor WKWebView is asking — the same `BlackOutiOSApp` token
 * that `apps/blackout-ios/capacitor.config.ts:appendUserAgent` puts on every
 * request from inside the app.
 *
 * Why we need a server variant: the client helper only fires after hydration, so
 * pricing / purchase markup (App Store guideline 3.1.1) still ships in the DOM
 * even under `.hide-in-ios-app`. Calling THIS in a server component lets us
 * SKIP the markup entirely — the app receives no pricing bytes at all — which
 * is the durable form of the CSS-only hide (a durable answer to "the reviewer
 * opens DevTools inside the WebView"). Client `isIosAppShell()` stays the
 * source of truth for dynamic/imperative UI; this covers the SSR side.
 *
 * NOTE — cache alignment: pages whose SSR now varies on `User-Agent` MUST NOT
 * be served from a cache that doesn't split on UA. Cloudflare's cache rule
 * `f261edb0…` (which force-caches `/`, `/upgrade`, `/learn*`) is
 * expression-guarded with `not http.user_agent contains "BlackOutiOSApp"` so
 * iOS app requests bypass the edge and hit the origin — mirroring the
 * `__session` bypass that solved the same class of bug on 2026-07-22.
 */
export async function isIosAppShellFromHeaders(): Promise<boolean> {
  try {
    const ua = (await headers()).get("user-agent") ?? "";
    return ua.includes("BlackOutiOSApp");
  } catch {
    // headers() throws in contexts where the request store isn't available
    // (e.g. static generation of a route that isn't force-dynamic). In that
    // case the safe default is "not iOS" — the CSS-hide (`.hide-in-ios-app`)
    // still protects those surfaces at runtime.
    return false;
  }
}
