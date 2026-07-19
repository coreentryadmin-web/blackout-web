import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { clerkMiddlewareAuthOptions, clerkSatelliteAuthRedirect } from "@/lib/clerk-env";
import { clerkIsClerkSyncFailed, clerkPostAuthReturnPath, CLERK_DEFAULT_POST_AUTH_PATH } from "@/lib/clerk-redirect-url";
import {
  clerkStaleCookieRecoveryResponse,
  requestHasClerkSessionCookie,
} from "@/lib/clerk-session-recovery";
import { activeClerkUserIdFromRequest } from "@/lib/clerk-session-from-request";
import {
  IS_STAGING,
  MUTATION_METHODS,
  PUBLIC_TELEMETRY_PATHS,
  withStagingNoEdgeCache,
} from "@/middleware-shared";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/flows(.*)",
  "/terminal(.*)",
  "/heatmap(.*)",
  "/nighthawk(.*)",
  "/vector(.*)",
  "/admin(.*)",
  "/account(.*)",
]);

const isWebhookRoute = createRouteMatcher(["/api/webhook/(.*)", "/api/webhooks/(.*)"]);
const isPublicTelemetryRoute = createRouteMatcher([
  "/api/telemetry/client-error",
  "/api/telemetry/auth-failure",
]);

export default clerkMiddleware(
  async (auth, req) => {
    if (requestHasClerkSessionCookie(req)) {
      try {
        await auth();
      } catch {
        return withStagingNoEdgeCache(clerkStaleCookieRecoveryResponse(req));
      }
    }

    const path = req.nextUrl.pathname;
    const isAuthPage = path === "/sign-in" || path.startsWith("/sign-in/") ||
                       path === "/sign-up" || path.startsWith("/sign-up/");
    if (isAuthPage) {
      // Clerk v7.5.x auth()/auth.protect() do not reliably return userId on sign-in
      // pages with the same cookies that work on /dashboard. Decode __session after
      // Clerk's authenticateRequest has already verified the request (PR #790).
      const userId = activeClerkUserIdFromRequest(req);
      if (userId) {
        const dest = req.nextUrl.searchParams.get("redirect_url") || CLERK_DEFAULT_POST_AUTH_PATH;
        return withStagingNoEdgeCache(
          NextResponse.redirect(new URL(dest, req.url), 307)
        );
      }
    }

    if (IS_STAGING && process.env.AUTH_PROVIDER !== "cognito") {
      if (path === "/sign-in" || path.startsWith("/sign-in/")) {
        const returnPath = req.nextUrl.searchParams.get("redirect_url") ?? CLERK_DEFAULT_POST_AUTH_PATH;
        const primary = clerkSatelliteAuthRedirect("sign-in", returnPath);
        if (primary) {
          return withStagingNoEdgeCache(NextResponse.redirect(primary, 307));
        }
      }
      if (path === "/sign-up" || path.startsWith("/sign-up/")) {
        const returnPath = req.nextUrl.searchParams.get("redirect_url") ?? CLERK_DEFAULT_POST_AUTH_PATH;
        const primary = clerkSatelliteAuthRedirect("sign-up", returnPath);
        if (primary) {
          return withStagingNoEdgeCache(NextResponse.redirect(primary, 307));
        }
      }
      if (clerkIsClerkSyncFailed(req.nextUrl)) {
        const hasClerkCookie =
          req.cookies.has("__session") || req.cookies.has("__client_uat");
        if (!hasClerkCookie) {
          const clean = new URL(req.nextUrl);
          clean.searchParams.delete("__clerk_synced");
          const retry = clerkSatelliteAuthRedirect(
            "sign-in",
            `${clean.pathname}${clean.search}`
          );
          if (retry) {
            return withStagingNoEdgeCache(NextResponse.redirect(retry, 307));
          }
        }
      }
    }

    if (isProtectedRoute(req)) {
      try {
        await auth.protect();
      } catch {
        return withStagingNoEdgeCache(clerkStaleCookieRecoveryResponse(req));
      }
    }

    if (
      MUTATION_METHODS.has(req.method) &&
      req.nextUrl.pathname.startsWith("/api/") &&
      !isWebhookRoute(req) &&
      !isPublicTelemetryRoute(req)
    ) {
      const bearer = req.headers.get("authorization") ?? "";
      const hasBearerToken = bearer.startsWith("Bearer ") && bearer.length > 27;
      const hasClerkCookie =
        req.cookies.has("__session") || req.cookies.has("__client_uat");

      if (!hasBearerToken && !hasClerkCookie) {
        return withStagingNoEdgeCache(
          NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        );
      }
    }

    return withStagingNoEdgeCache(NextResponse.next());
  },
  clerkMiddlewareAuthOptions()
);

export { PUBLIC_TELEMETRY_PATHS };
