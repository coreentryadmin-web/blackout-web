import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/flows",
  "/terminal",
  "/heatmap",
  "/nighthawk",
  "/vector",
  "/meridian",
  "/admin",
  "/account",
];

export const PUBLIC_TELEMETRY_PATHS = new Set([
  "/api/telemetry/client-error",
  "/api/telemetry/auth-failure",
]);

export const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const IS_STAGING =
  (process.env.NEXT_PUBLIC_SITE_URL ?? "").includes("staging.") ||
  process.env.SENTRY_ENVIRONMENT === "staging";

export function withStagingNoEdgeCache(res: NextResponse): NextResponse {
  if (!IS_STAGING) return res;
  res.headers.set("CDN-Cache-Control", "no-store");
  res.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  res.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  return res;
}

export function withNoEdgeCache(res: NextResponse): NextResponse {
  res.headers.set("CDN-Cache-Control", "no-store");
  res.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  res.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  return res;
}

export function isAuthExemptPath(_pathname: string): boolean {
  // The Cognito OAuth callback/login/logout endpoints were the only auth-exempt paths; they were
  // removed when Cognito was decommissioned (production auth is Clerk-only). Kept as a stable
  // predicate — currently nothing is exempt — so callers don't need to change.
  return false;
}

export function hasBearerToken(req: NextRequest): boolean {
  const bearer = req.headers.get("authorization") ?? "";
  return bearer.startsWith("Bearer ") && bearer.length > 27;
}
