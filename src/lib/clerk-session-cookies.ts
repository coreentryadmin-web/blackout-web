import { cookies } from "next/headers";
import { activeClerkUserIdFromSessionCookie } from "@/lib/clerk-session-jwt";

/** Clerk may set __session or __session_<publishableKeySuffix> — check all. */
export function activeClerkUserIdFromCookieStore(
  jar: Awaited<ReturnType<typeof cookies>>
): string | null {
  const direct = jar.get("__session")?.value;
  if (direct) {
    const uid = activeClerkUserIdFromSessionCookie(direct);
    if (uid) return uid;
  }
  for (const c of jar.getAll()) {
    if (c.name.startsWith("__session_") && c.name !== "__session") {
      const uid = activeClerkUserIdFromSessionCookie(c.value);
      if (uid) return uid;
    }
  }
  return null;
}

function isActiveUatValue(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) && v > 0;
}

/** True when request carries an active Clerk session or __client_uat session signal.
 *  Clerk suffixes __session and __client_uat together (never one without the other) when this
 *  instance's cookie name collides with another Clerk instance on the same top-level domain
 *  (see clerk-session-recovery.ts's requestHasClerkSessionCookie, which already handles this for
 *  the identical cookie pair). The __session side is handled above via
 *  activeClerkUserIdFromCookieStore; this must check the suffixed __client_uat_<suffix> variant
 *  too, not just the bare name, or a request whose __session JWT doesn't decode here (e.g. a
 *  suffixed-only browser mid-refresh) falls through to a __client_uat check that is blind to the
 *  exact same suffix mechanism #797 was filed against. */
export function signedInFromCookieStore(jar: Awaited<ReturnType<typeof cookies>>): boolean {
  if (activeClerkUserIdFromCookieStore(jar)) return true;
  if (isActiveUatValue(jar.get("__client_uat")?.value)) return true;
  for (const c of jar.getAll()) {
    if (c.name.startsWith("__client_uat_") && c.name !== "__client_uat" && isActiveUatValue(c.value)) {
      return true;
    }
  }
  return false;
}

export async function signedInFromRequestCookies(): Promise<boolean> {
  return signedInFromCookieStore(await cookies());
}

/** Server Components / route handlers — read active Clerk user from __session cookie. */
export async function activeClerkUserIdFromRequestCookies(): Promise<string | null> {
  return activeClerkUserIdFromCookieStore(await cookies());
}
