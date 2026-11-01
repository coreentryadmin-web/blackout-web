import { clerkClientCookieValue } from "@/lib/clerk-client-cookie";

/**
 * Clerk `__client_uat` (or `__client_uat_<suffix>`) — non-httpOnly session signal for CDN/SSR
 * chrome healing. See `clerk-client-cookie.ts` for why the suffixed variant must be scanned too:
 * a signed-in member whose browser carries only the suffixed pair (confirmed live, #797/#7082)
 * previously made this always return `null`, so every caller that "self-heals" off this signal
 * (`Nav.tsx`'s cookie-authed desk chrome, `useMarketingSignedIn`'s post-hydration upgrade)
 * silently never fired for that real cookie shape.
 */
export function readClientSignedIn(): boolean | null {
  const raw = clerkClientCookieValue("__client_uat");
  if (raw === null) return null;
  const v = parseInt(decodeURIComponent(raw), 10);
  return Number.isFinite(v) && v > 0;
}

/** Prefer live cookie over SSR guess so the first client paint matches session state. */
export function resolveClientSignedIn(serverSignedIn: boolean): boolean {
  const client = readClientSignedIn();
  if (client !== null) return client;
  return serverSignedIn;
}
