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

/** True when request carries an active Clerk session or __client_uat session signal. */
export function signedInFromCookieStore(jar: Awaited<ReturnType<typeof cookies>>): boolean {
  if (activeClerkUserIdFromCookieStore(jar)) return true;
  const uat = jar.get("__client_uat")?.value;
  if (!uat) return false;
  const v = parseInt(uat, 10);
  return Number.isFinite(v) && v > 0;
}

export async function signedInFromRequestCookies(): Promise<boolean> {
  return signedInFromCookieStore(await cookies());
}

/** Server Components / route handlers — read active Clerk user from __session cookie. */
export async function activeClerkUserIdFromRequestCookies(): Promise<string | null> {
  return activeClerkUserIdFromCookieStore(await cookies());
}
