"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readClientSignedIn, resolveClientSignedIn } from "@/lib/client-signed-in";

// NavAuthLinks — marketing nav auth block, resilient to static generation and edge caching.
// Server passes its best guess; __client_uat wins on the FIRST client render (not after an effect).

/** @deprecated import from `@/lib/client-signed-in` */
export { readClientSignedIn } from "@/lib/client-signed-in";

export function NavAuthLinks({ signedIn: initial }: { signedIn: boolean }) {
  const [signedIn, setSignedIn] = useState(() => resolveClientSignedIn(initial));

  useEffect(() => {
    const client = readClientSignedIn();
    if (client !== null && client !== signedIn) setSignedIn(client);
  }, [signedIn]);

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
