import { tierAtLeast, type Tier } from "@/lib/tiers";
import type { ToolKey } from "@/lib/tool-access";
import { resolveUserTier, TierUnavailableError } from "@/lib/tier-cache";
import { userCanAccessTool } from "@/lib/tool-access-server";

export type SseStreamEntitlementVerdict = "ok" | "forbidden" | "unavailable";

/**
 * Re-check tier (+ optional tool launch gate) for a long-lived SSE connection.
 * Intentionally omits session JWT claims so Whop cancellation / publishTierChanged
 * invalidation is honored on the next tick — the connect-time JWT check is not enough.
 */
export async function recheckSseUserEntitlement(
  userId: string,
  minTier: Tier,
  tool?: ToolKey,
): Promise<SseStreamEntitlementVerdict> {
  try {
    const tier = await resolveUserTier(userId);
    if (!tierAtLeast(tier, minTier)) return "forbidden";
    if (tool) {
      const allowed = await userCanAccessTool(userId, tool);
      if (!allowed) return "forbidden";
    }
    return "ok";
  } catch (err) {
    if (err instanceof TierUnavailableError) return "unavailable";
    throw err;
  }
}
