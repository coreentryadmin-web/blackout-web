"use client";

import Link from "next/link";
import { useMarketingSignedIn } from "@/lib/use-marketing-signed-in";

// NavAuthLinks — marketing nav auth block, resilient to static generation and edge caching.
// Server passes its best guess; __client_uat wins on the FIRST client render, then /api/auth/me
// verifies the session so expired cookies don't keep showing "Open desk".

/** @deprecated import from `@/lib/client-signed-in` */
export { readClientSignedIn } from "@/lib/client-signed-in";

export function NavAuthLinks({ signedIn: initial }: { signedIn: boolean }) {
  const signedIn = useMarketingSignedIn(initial);

  if (signedIn) {
    return (
      <Link href="/dashboard" prefetch={false} className="nav-join">
        Open desk <span className="cta-arrow">→</span>
      </Link>
    );
  }
  return (
    <>
      <Link href="/sign-in" prefetch={false} className="nav-signin">
        Sign in
      </Link>
      <Link href="/sign-up" prefetch={false} className="nav-join">
        Get access <span className="cta-arrow">→</span>
      </Link>
    </>
  );
}

export default NavAuthLinks;
