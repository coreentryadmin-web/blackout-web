"use client";

import { useEffect, useState } from "react";
import { readClientSignedIn, resolveClientSignedIn } from "@/lib/client-signed-in";

/**
 * Marketing auth chrome — optimistic __client_uat first paint, then verify the
 * real Clerk session so expired cookies don't keep showing "Open desk".
 */
export function useMarketingSignedIn(serverSignedIn: boolean): boolean {
  const [signedIn, setSignedIn] = useState(() => resolveClientSignedIn(serverSignedIn));

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
