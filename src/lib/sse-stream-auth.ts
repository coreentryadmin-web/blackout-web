import type { Tier } from "@/lib/tiers";
import type { ToolKey } from "@/lib/tool-access";
import { requireTierApi } from "@/lib/market-api-auth";

/** Auth context captured at SSE connection-open for long-lived streams. */
export type SseStreamAuthContext = {
  /** Cron-secret connections are authorized once at open — no mid-stream tier to revoke. */
  via: "cron" | "user";
  minTier: Tier;
  /** Optional desk launch gate (nighthawk, vector, …) re-checked on every tick for user sessions. */
  toolKey?: ToolKey;
};

/**
 * Re-run tier (+ optional tool) gates for a long-lived SSE connection.
 * Mirrors the per-request gate on the REST fallback routes so a lapsed Whop
 * membership stops premium data within one tick instead of when the tab closes.
 *
 * @returns null when still authorized; a 401/403/503 Response when the stream must end.
 */
export async function recheckSseStreamAuth(
  ctx: SseStreamAuthContext
): Promise<Response | null> {
  if (ctx.via === "cron") return null;

  const tier = await requireTierApi(ctx.minTier);
  if (tier instanceof Response) return tier;

  if (ctx.toolKey) {
    const { requireToolApi } = await import("@/lib/tool-access-server");
    const denied = await requireToolApi(ctx.toolKey);
    if (denied) return denied;
  }

  return null;
}
