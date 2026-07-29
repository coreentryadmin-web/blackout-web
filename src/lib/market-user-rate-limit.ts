/**
 * Per-user fixed-window rate limits for premium market endpoints (flows REST + SSE).
 * Reuses the same Redis + in-memory-fallback machinery as ip-rate-limit.ts so a Redis
 * blip still enforces a coarse per-process cap instead of fail-open unbounded.
 *
 * Defaults are generous for normal desk use (HELIX polls ~every few seconds; one SSE
 * connection per desk). They bound abuse / accidental fan-out, not normal members.
 */

import { checkIpRateLimit, type RateLimitResult } from "@/lib/ip-rate-limit";

function envPositiveInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]?.trim());
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** REST /api/market/flows — default 120/min (~2/s). */
export function marketFlowsRestLimit(): number {
  return envPositiveInt("MARKET_FLOWS_USER_RATE_LIMIT", 120);
}

/** SSE /api/market/flows/stream connection attempts — default 30/min. */
export function marketFlowsSseLimit(): number {
  return envPositiveInt("MARKET_FLOWS_SSE_USER_RATE_LIMIT", 30);
}

export async function checkUserMarketRateLimit(
  userId: string,
  key: string,
  limit: number,
  windowSecs = 60
): Promise<RateLimitResult> {
  // Keyed by userId through the IP limiter's redis key namespace — the "ip" slot is
  // just the identity string; checkIpRateLimit already scopes by (identity, key, window).
  return checkIpRateLimit(`user:${userId}`, key, limit, windowSecs);
}

/** 429 JSON for market desk rate limits. */
export function marketRateLimitResponse(result: RateLimitResult): Response {
  return new Response(JSON.stringify({ error: "Rate limit exceeded", limit: result.limit }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": "60",
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
    },
  });
}

/** Convenience: rate-limit flows REST after authorizeMarketDeskApi succeeded. Cron → skip. */
export async function enforceFlowsRestRateLimit(
  userId: string | null
): Promise<Response | null> {
  if (!userId) return null;
  const result = await checkUserMarketRateLimit(userId, "market:flows", marketFlowsRestLimit());
  return result.ok ? null : marketRateLimitResponse(result);
}

export async function enforceFlowsSseRateLimit(
  userId: string | null
): Promise<Response | null> {
  if (!userId) return null;
  const result = await checkUserMarketRateLimit(
    userId,
    "market:flows:sse",
    marketFlowsSseLimit()
  );
  return result.ok ? null : marketRateLimitResponse(result);
}
