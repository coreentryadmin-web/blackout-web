"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// NavAuthLinks — the marketing nav's auth block, made resilient to static
// generation and edge caching. The server passes its best guess (`signedIn`
// from the request cookies), which is correct for dynamic, uncached renders —
// but marketing pages can be statically generated (`force-static`) or edge-
// cached, in which case that guess is frozen to the anonymous state and a
// signed-in visitor would wrongly see "Sign in".
//
// After mount, this reads Clerk's `__client_uat` cookie — a NON-httpOnly
// signal Clerk maintains precisely for CDN/SSR cache correctness: "0" (or
// absent) when signed out, a nonzero unix timestamp when a session is active.
// If it disagrees with the server guess, we correct the nav on the client. This
// is defense-in-depth alongside the Cloudflare cookie-bypass rule: even a
// wrongly-cached anonymous shell self-heals to the right auth chrome.
function readClientSignedIn(): boolean | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)__client_uat=([^;]+)/);
  if (!m) return null;
  const v = parseInt(decodeURIComponent(m[1]), 10);
  return Number.isFinite(v) && v > 0;
}

export function NavAuthLinks({ signedIn: initial }: { signedIn: boolean }) {
  // First client render must equal the server render to avoid a hydration
  // mismatch, so we seed with the server guess and reconcile in an effect.
  const [signedIn, setSignedIn] = useState(initial);

  useEffect(() => {
    const client = readClientSignedIn();
    if (client !== null && client !== signedIn) setSignedIn(client);
  }, [signedIn]);

  if (signedIn) {
    return (
      <Link href="/dashboard" prefetch={false} className="nav-join">
        Open desk →
      </Link>
    );
  }
  return (
    <>
      <Link href="/sign-in" prefetch={false} className="nav-signin">
        Sign in
      </Link>
      <Link href="/sign-up" prefetch={false} className="nav-join">
        Get access →
      </Link>
    </>
  );
}

export default NavAuthLinks;
