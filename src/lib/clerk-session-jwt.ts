/**
 * Read active Clerk user id from the __session cookie JWT payload.
 *
 * Clerk v7.5.x `auth()` / `auth.protect()` can return null userId on /sign-in and
 * /sign-up even when the session cookie is valid (authenticateRequest + toAuth
 * path inconsistency). Middleware uses this as a decode-only fallback AFTER Clerk
 * has already run authenticateRequest on the request — we never trust an unverified
 * token for authorization on protected routes.
 */

export type ClerkSessionJwtPayload = {
  sub?: string;
  exp?: number;
  sts?: string;
};

/** Base64url-decode the JWT payload segment (Edge-safe; no signature verify). */
export function decodeClerkSessionJwtPayload(token: string): ClerkSessionJwtPayload | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    return JSON.parse(atob(b64)) as ClerkSessionJwtPayload;
  } catch {
    return null;
  }
}

/**
 * Returns Clerk user id when the __session JWT looks like an active, unexpired session.
 * Returns null for missing/malformed/expired/pending tokens.
 */
export function activeClerkUserIdFromSessionCookie(
  sessionToken: string | undefined | null
): string | null {
  if (!sessionToken) return null;
  const payload = decodeClerkSessionJwtPayload(sessionToken);
  if (!payload?.sub || typeof payload.exp !== "number") return null;
  if (payload.exp <= Date.now() / 1000) return null;
  if (payload.sts != null && payload.sts !== "active") return null;
  return payload.sub;
}
