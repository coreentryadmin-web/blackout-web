import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { clerkMiddlewareAuthOptions, clerkSatelliteAuthRedirect } from "@/lib/clerk-env";
import { clerkIsClerkSyncFailed, clerkPostAuthReturnPath } from "@/lib/clerk-redirect-url";
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
  withNoEdgeCache,
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

/** Dev-only Vector board UI preview — must not match `/vector(.*)` auth above. */
const isVectorBoardDevPreview = createRouteMatcher(["/vector-board-preview"]);

const isWebhookRoute = createRouteMatcher(["/api/webhook/(.*)", "/api/webhooks/(.*)"]);
const isPublicTelemetryRoute = createRouteMatcher([
  "/api/telemetry/client-error",
  "/api/telemetry/auth-failure",
]);

/**
 * Public endpoints that are legitimately POSTed by a LOGGED-OUT visitor.
 *
 * The mutation guard below rejects any POST/PUT/PATCH/DELETE to /api/* without a Bearer token or
 * Clerk cookie. That is the right default, but it is enforced in MIDDLEWARE — before the route
 * runs — so a route being "public" in its own handler (and allowlisted in
 * scripts/verify-api-auth-guards.mjs, which is a static source scan with no knowledge of
 * middleware) is not enough. A public POST route that is not listed here returns 401 to exactly
 * the audience it exists for, and nothing in CI catches it: the guard scan passes, tsc passes,
 * unit tests pass, and only a real request from a signed-out client reveals it.
 *
 * Found live 2026-08-08: /api/public/email-capture — the exit-intent lead capture — had never
 * worked in production for the anonymous visitors it was built for.
 *
 * Adding a route here removes its blanket auth requirement, so each one must carry its own abuse
 * controls. email-capture does: IP rate limit (5/60s), a 1/24h per-RECIPIENT cooldown so the
 * address cannot be mail-bombed, hard body-field length caps, and address validation.
 */
const isPublicMutationRoute = createRouteMatcher([
  "/api/public/email-capture",
  // RFC 8058 one-click unsubscribe is a POST — that is what the List-Unsubscribe-Post header we
  // set advertises, and what Gmail/Yahoo actually send. The GET (a human clicking the link)
  // already passed the guard, so the link LOOKED functional while the mechanism the bulk-sender
  // rules require was returning 401. Both verbs must be exempt.
  "/api/public/email-unsubscribe",
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
    // /upgrade renders auth-dependent chrome (Sign in vs Open desk). Always bypass
    // edge cache at the middleware layer — CF HTML rule still may force-cache anon,
    // but signed-in requests and origin headers stay aligned with /sign-in|/sign-up.
    const isAuthChromePage = isAuthPage || path === "/upgrade" || path.startsWith("/upgrade/");
    const signedInUserId = activeClerkUserIdFromRequest(req);

    if (isAuthPage && signedInUserId) {
      // Clerk v7.5.x auth()/auth.protect() do not reliably return userId on sign-in
      // pages with the same cookies that work on /dashboard. Decode __session after
      // Clerk's authenticateRequest has already verified the request (PR #790).
      // Sanitize redirect_url — raw absolute/protocol-relative values enable open redirect
      // via `new URL(dest, req.url)` (absolute overrides base).
      const dest = clerkPostAuthReturnPath(req.nextUrl.searchParams.get("redirect_url"));
      return withStagingNoEdgeCache(
        NextResponse.redirect(new URL(dest, req.url), 307)
      );
    }

    if (IS_STAGING) {
      if (path === "/sign-in" || path.startsWith("/sign-in/")) {
        const returnPath = clerkPostAuthReturnPath(req.nextUrl.searchParams.get("redirect_url"));
        const primary = clerkSatelliteAuthRedirect("sign-in", returnPath);
        if (primary) {
          return withStagingNoEdgeCache(NextResponse.redirect(primary, 307));
        }
      }
      if (path === "/sign-up" || path.startsWith("/sign-up/")) {
        const returnPath = clerkPostAuthReturnPath(req.nextUrl.searchParams.get("redirect_url"));
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

    if (
      isVectorBoardDevPreview(req) &&
      process.env.NODE_ENV !== "production"
    ) {
      return withStagingNoEdgeCache(NextResponse.next());
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
      !isPublicTelemetryRoute(req) &&
      !isPublicMutationRoute(req)
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

    if (isAuthChromePage || isProtectedRoute(req)) {
      return withNoEdgeCache(NextResponse.next());
    }

    return withStagingNoEdgeCache(NextResponse.next());
  },
  clerkMiddlewareAuthOptions()
);

export { PUBLIC_TELEMETRY_PATHS };
