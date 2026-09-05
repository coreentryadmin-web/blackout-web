import "server-only";

import type { Tier } from "@/lib/tiers";
import { requireTierApi } from "@/lib/market-api-auth";
import {
  type DeskApiAuth,
  requireToolApiForDeskCaller,
} from "@/lib/tool-access-server";
import type { ToolKey } from "@/lib/tool-access";

/**
 * Re-run tier + tool gates for a long-lived SSE connection.
 * Cron callers skip (same as the one-shot connect gate). User callers re-check every
 * tick so a mid-session Whop cancellation / tier downgrade cannot keep streaming
 * premium live-money marks indefinitely.
 */
export async function recheckUserSseDeskAccess(
  authCtx: DeskApiAuth,
  minTier: Tier,
  toolKey: ToolKey
): Promise<Response | null> {
  if (authCtx.via === "cron") return null;

  const tierResult = await requireTierApi(minTier);
  if (tierResult instanceof Response) return tierResult;

  if (authCtx.userId && tierResult.userId !== authCtx.userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return requireToolApiForDeskCaller(authCtx, toolKey);
}
