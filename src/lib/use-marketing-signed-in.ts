"use client";

import { useEffect, useState } from "react";
import { readClientSignedIn } from "@/lib/client-signed-in";

/**
 * Marketing auth chrome — matches the server's guess on the first render (required for
 * hydration: React reconciles the client's FIRST render against the static/ISR HTML, and any
 * difference throws "Hydration failed" (React #418), which the marketing pages have no recovery
 * from other than the page-level error boundary), then upgrades to the live `__client_uat` cookie
 * one tick later, then verifies the real Clerk session so expired cookies don't keep showing
 * "Open desk".
 *
 * The initial state MUST be `serverSignedIn` verbatim, not `resolveClientSignedIn(serverSignedIn)`
 * — that reads `document.cookie` during the render React uses for hydration, which the server
 * (revalidate=3600 ISR, no per-request cookie access) can never match. Every signed-in member
 * landing on the cached homepage/marketing pages hit this: `readClientSignedIn()` returns `true`
 * client-side while the cached HTML said "Sign in", and the Link↔Fragment structural swap in
 * NavAuthLinks can't be patched as a same-position text diff.
 *
 * Confirmed live 2026-09-01 with `page.on('pageerror')` capture against a real authenticated
 * session on production: `blackouttrades.com/` threw `Minified React error #418` (hydration
 * mismatch) on BOTH desktop (1440px) and mobile (430px) viewports — not viewport-specific, and
 * NOT deterministic either: an earlier same-session desktop load was caught by the marketing error
 * boundary ("Something went wrong" instead of the homepage), while a later mobile load with an
 * equally-authenticated cookie silently recovered (React discarded the mismatched SSR output and
 * redid the render client-side, the standard React 18 hydration-error recovery path) and rendered
 * correctly with no visible symptom. Whether a given page load crashes outright or silently
 * self-heals depends on timing this fix doesn't need to pin down — removing the mismatch removes
 * both outcomes.
 */
export function useMarketingSignedIn(serverSignedIn: boolean): boolean {
  const [signedIn, setSignedIn] = useState(serverSignedIn);

  useEffect(() => {
    const client = readClientSignedIn();
    if (client !== null && client !== signedIn) setSignedIn(client);
  }, [signedIn]);

  useEffect(() => {
    let cancelled = false;
    const cookieSaysIn = readClientSignedIn();
    if (cookieSaysIn !== true) return;

    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { signedIn?: boolean };
        if (!cancelled && data.signedIn === false) setSignedIn(false);
      } catch {
        /* network blip — keep cookie-derived chrome */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return signedIn;
}
