import { tierAtLeast, type Tier } from "@/lib/tiers";
import { resolveUserTier, TierUnavailableError } from "@/lib/tier-cache";
import { userCanAccessTool } from "@/lib/tool-access-server";
import type { ToolKey } from "@/lib/tool-access";

export type SseStreamAuthContext = {
  userId: string;
  minTier: Tier;
  toolKey?: ToolKey;
};

/**
 * Re-check tier (+ optional tool launch gate) for a long-lived SSE connection.
 * Intentionally omits session JWT claims so Whop cancellation / publishTierChanged
 * invalidation is honored on the next tick — the connect-time check is not enough.
 */
export async function revalidateSseStreamAccess(
  ctx: SseStreamAuthContext
): Promise<"ok" | "forbidden" | "unavailable"> {
  try {
    const tier = await resolveUserTier(ctx.userId);
    if (!tierAtLeast(tier, ctx.minTier)) return "forbidden";
    if (ctx.toolKey) {
      const allowed = await userCanAccessTool(ctx.userId, ctx.toolKey);
      if (!allowed) return "forbidden";
    }
    return "ok";
  } catch (err) {
    if (err instanceof TierUnavailableError) return "unavailable";
    throw err;
  }
}
