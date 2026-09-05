import type { Tier } from "@/lib/tiers";
import type { ToolKey } from "@/lib/tool-access";
import { requireTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";

/**
 * Re-run tier + tool gates on each SSE tick so a lapsed membership stops receiving
 * premium live data without waiting for the browser to reconnect. Cron bearer auth is
 * checked only at connection open — callers skip this when `via === "cron"`.
 */
export async function recheckSseUserEntitlement(
  minTier: Tier,
  tool?: ToolKey,
): Promise<Response | null> {
  const tier = await requireTierApi(minTier);
  if (tier instanceof Response) return tier;
  if (!tool) return null;
  return requireToolApi(tool);
}
