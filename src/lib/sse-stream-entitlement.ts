import { tierAtLeast, type Tier } from "@/lib/tiers";
import { resolveUserTier, TierUnavailableError } from "@/lib/tier-cache";
import { userCanAccessTool } from "@/lib/tool-access-server";
import type { ToolKey } from "@/lib/tool-access";

export type SseEntitlementVerdict = "ok" | "forbidden" | "unavailable";

export type SseEntitlementContext = {
  userId: string;
  minTier: Tier;
  tool?: ToolKey;
};

/**
 * Re-check tier (+ optional tool launch gate) for a long-lived SSE connection.
 * Intentionally omits session JWT claims so Whop cancellation / publishTierChanged
 * invalidation is honored on the next tick — connect-time auth() is not enough.
 */
export async function recheckSseUserEntitlement(
  ctx: SseEntitlementContext
): Promise<SseEntitlementVerdict> {
  try {
    const { isAdminUser } = await import("@/lib/admin-access");
    if (await isAdminUser(ctx.userId)) {
      if (ctx.tool) {
        const allowed = await userCanAccessTool(ctx.userId, ctx.tool);
        if (!allowed) return "forbidden";
      }
      return "ok";
    }

    const tier = await resolveUserTier(ctx.userId);
    if (!tierAtLeast(tier, ctx.minTier)) return "forbidden";
    if (ctx.tool) {
      const allowed = await userCanAccessTool(ctx.userId, ctx.tool);
      if (!allowed) return "forbidden";
    }
    return "ok";
  } catch (err) {
    if (err instanceof TierUnavailableError) return "unavailable";
    throw err;
  }
}
