import type { NextRequest } from "next/server";
import {
  clerkStaleCookieRecoveryResponse,
  requestHasClerkSessionCookie,
} from "@/lib/clerk-session-recovery";

/** Inline only — Next.js cannot analyze re-exported middleware config. */
export const config = {
  matcher: [
    {
      source:
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
      missing: [{ type: "header", key: "upgrade", value: "websocket" }],
    },
    {
      source: "/(api|trpc)(.*)",
      missing: [{ type: "header", key: "upgrade", value: "websocket" }],
    },
    {
      source: "/__clerk/(.*)",
      missing: [{ type: "header", key: "upgrade", value: "websocket" }],
    },
  ],
};

type MiddlewareFn = (req: NextRequest, event?: unknown) => Response | Promise<Response>;

function loadClerkMiddleware(): MiddlewareFn {
  // Lazy require so a load-time failure in the Clerk middleware still lets the stale-cookie
  // recovery path below run instead of taking down every request.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/middleware-clerk").default as MiddlewareFn;
}

const handler: MiddlewareFn = async (req: NextRequest, event?: unknown) => {
  try {
    return await loadClerkMiddleware()(req, event);
  } catch {
    if (requestHasClerkSessionCookie(req)) {
      return clerkStaleCookieRecoveryResponse(req);
    }
    throw new Error("Clerk middleware failed without session cookies");
  }
};

export default handler;
