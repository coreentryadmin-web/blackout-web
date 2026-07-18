import { cookies } from "next/headers";
import { activeClerkUserIdFromSessionCookie } from "@/lib/clerk-session-jwt";

/** Server Components / route handlers — read active Clerk user from __session cookie. */
export async function activeClerkUserIdFromRequestCookies(): Promise<string | null> {
  const jar = await cookies();
  return activeClerkUserIdFromSessionCookie(jar.get("__session")?.value);
}
