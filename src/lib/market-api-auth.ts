import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { tierAtLeast, type Tier } from "@/lib/tiers";
import { resolveUserTier, TierUnavailableError } from "@/lib/tier-cache";
import { auth } from "@/lib/auth-server";

export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const authHeader = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  // Constant-time compare — this is the single auth gate for all 23 cron writers (every
  // route under api/cron/*), so the `===` early-exit shouldn't leak the secret
  // byte-by-byte via response timing.
  const a = Buffer.from(authHeader);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** API routes — returns 401/403/503 JSON or {userId,tier} if allowed. */
export async function requireTierApi(
  minTier: Tier
): Promise<{ userId: string; tier: Tier } | Response> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { isAdminUser } = await import("@/lib/admin-access");
  if (await isAdminUser(userId, sessionClaims)) {
    return { userId, tier: "premium" };
  }

  // Cache-first tier resolution shared with the page gate (resolveUserTier): ~one Clerk
  // call per user per minute, with last-known-tier fallback so a transient Clerk failure
  // doesn't kick out a paying user. Session JWT claims (tier) skip the Backend getUser when configured.
  let tier: Tier;
  try {
    tier = await resolveUserTier(userId, sessionClaims);
  } catch (err) {
    // Clerk unreachable AND no cached tier → RETRYABLE 503 (not a hard 401/500) so the
    // client backs off and retries instead of seeing a misleading "Unauthorized".
    if (!(err instanceof TierUnavailableError)) throw err;
    return jsonResponse({ error: "Auth check temporarily unavailable" }, 503);
  }

  if (!tierAtLeast(tier, minTier)) {
    return jsonResponse({ error: "Forbidden — upgrade required" }, 403);
  }

  return { userId, tier };
}

/** Cron secret OR premium Clerk session — for stateful market engines. */
export async function authorizeCronOrTierApi(
  req: NextRequest,
  minTier: Tier = "premium"
): Promise<{ userId: string | null; via: "cron" | "user" } | Response> {
  if (isCronAuthorized(req)) {
    return { userId: null, via: "cron" };
  }
  const result = await requireTierApi(minTier);
  if (result instanceof Response) return result;
  return { userId: result.userId, via: "user" };
}

/** SPX Slayer desk market data — cron OR signed-in COMMUNITY+ user. This is the correct gate ONLY
 *  for the community-tier SPX dashboard's data (spx/*, indices, quote, gex-*, dark-pool, news,
 *  earnings). It must NOT be used for premium-exclusive products — see {@link authorizePremiumDeskApi}.
 *
 *  History: this helper's old doc claimed "page-level gates on non-SPX routes still require premium;
 *  this only gates the data API layer" — but the API layer IS the sole enforcement point (middleware
 *  matches only page paths, not /api/market/*), so that comment described the vulnerability, not a
 *  mitigation. Twenty premium routes (HELIX flows, Thermal heatmap, all of Vector, the premium
 *  briefs) were wired to this community gate, letting a $49 community member pull $199 premium data
 *  by hitting the API directly (CWE-863). Those routes now use authorizePremiumDeskApi. */
export async function authorizeMarketDeskApi(
  req: NextRequest
): Promise<{ userId: string | null; via: "cron" | "user" } | Response> {
  return authorizeCronOrTierApi(req, "community");
}

/** Premium-exclusive desk market data — cron OR signed-in PREMIUM user. The data-API gate for every
 *  product whose page calls requireTier("premium"): HELIX flows (/flows), BlackOut Thermal
 *  (/heatmap), the whole Vector suite (/vector/*), and the premium briefs (brief/premarket,
 *  platform/intel). The API is the only enforcement point for these — the page redirect is not a
 *  security control, it is just UX — so the tier MUST be re-checked here at premium. */
export async function authorizePremiumDeskApi(
  req: NextRequest
): Promise<{ userId: string | null; via: "cron" | "user" } | Response> {
  return authorizeCronOrTierApi(req, "premium");
}
