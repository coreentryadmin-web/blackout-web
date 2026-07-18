import type { NextRequest } from "next/server";
import { activeClerkUserIdFromSessionCookie } from "@/lib/clerk-session-jwt";

/** First active Clerk __session JWT on the request (handles suffixed cookie names). */
export function activeClerkUserIdFromRequest(req: NextRequest | Request): string | null {
  const jar = "cookies" in req ? req.cookies : null;
  if (!jar) return null;
  const direct = jar.get("__session")?.value;
  if (direct) {
    const uid = activeClerkUserIdFromSessionCookie(direct);
    if (uid) return uid;
  }
  if ("getAll" in jar && typeof jar.getAll === "function") {
    for (const c of jar.getAll()) {
      if (c.name.startsWith("__session_") && c.name !== "__session") {
        const uid = activeClerkUserIdFromSessionCookie(c.value);
        if (uid) return uid;
      }
    }
  }
  return null;
}
