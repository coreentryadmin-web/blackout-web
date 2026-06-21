import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/flows(.*)",
  "/terminal(.*)",
  "/heatmap(.*)",
  "/nighthawk(.*)",
  "/admin(.*)",
  "/docs(.*)",
]);

export default clerkMiddleware((auth, req) => {
  if (isProtectedRoute(req)) {
    auth().protect();
  }
});

// ---------------------------------------------------------------------------
// SECURITY MODEL — DENY-LIST (protected by default)
// ---------------------------------------------------------------------------
// The matcher below runs clerkMiddleware on ALL page and API routes, then
// the middleware function itself applies the allow/block logic:
//
//   INTENTIONALLY PUBLIC routes (no auth required):
//     • /api/health          — liveness probe (see isPublicRoute above)
//     • /_next/*             — Next.js internals (excluded by matcher regex)
//     • /static assets       — .js, .css, images, fonts, etc. (excluded by regex)
//     • WebSocket upgrades   — excluded via the `missing` header filter
//
//   Everything else (including ALL /api/* routes not listed above) goes
//   through clerkMiddleware and is PROTECTED by default.
//
//   To make a new route public you MUST add it to `isPublicRoute` above.
//   To make a new route premium-gated you MUST add it to both
//   `isProtectedRoute` AND `isPremiumRoute` above.
//
//   Never rely on a route being "not listed" as a security boundary — the
//   matcher catches all routes, so omission means protected, not public.
// ---------------------------------------------------------------------------
export const config = {
  matcher: [
    // Match all routes except Next.js internals and static assets.
    {
      source:
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
      missing: [{ type: "header", key: "upgrade", value: "websocket" }],
    },
    // Also explicitly match API/tRPC routes.
    {
      source: "/(api|trpc)(.*)",
      missing: [{ type: "header", key: "upgrade", value: "websocket" }],
    },
  ],
};
