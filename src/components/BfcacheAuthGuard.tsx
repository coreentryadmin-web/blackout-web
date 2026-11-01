"use client";

import { useEffect } from "react";

/**
 * `Cache-Control: no-store` (set on every authenticated route by `withNoEdgeCache` in
 * middleware-shared.ts) does NOT reliably block the back/forward cache in current browsers.
 * Chrome stopped excluding `no-store` pages from bfcache starting with Chrome 109 (bfcache is a
 * separate mechanism from HTTP caching), and Firefox/Safari have long applied their own
 * fastback/page-cache aggressively regardless of cache headers. A bfcache restore freezes and
 * replays the ENTIRE JS heap exactly as it was at navigation-away time — no React effect re-runs,
 * so `SessionCacheGuard`'s sign-out cleanup (which only fires from a live `isSignedIn` state
 * transition) never sees it. Net effect: sign out on an authenticated page, then press the
 * browser's real Back button, and the previous render can reappear from bfcache with no
 * server round-trip and no client-side re-check — until the next interaction forces one.
 */
export function shouldReloadOnBfcacheRestore(event: Pick<PageTransitionEvent, "persisted">): boolean {
  return event.persisted === true;
}

/** Forces a fresh server round-trip (which re-runs Clerk's auth middleware) whenever a page is
 * restored from bfcache, so a signed-out viewer can never see a stale authenticated snapshot. */
export function BfcacheAuthGuard() {
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (shouldReloadOnBfcacheRestore(event)) {
        window.location.reload();
      }
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  return null;
}
