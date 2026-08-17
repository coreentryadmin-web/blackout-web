import "server-only";

import type { GreekExposureSummary } from "@/lib/greek-exposure-summary";
import { loadSpxDesk } from "@/features/spx/lib/spx-desk-loader";

export type MeridianDeskLane = {
  net_flow_by_expiry: Record<string, unknown>[];
  greek_exposure: GreekExposureSummary | null;
};

/**
 * Read SPX desk enrichment lanes (net flow by expiry, UW greek pin) from the shared
 * desk cache — populated by desk-warm / buildSpxDesk, not live UW per Meridian request.
 */
export async function readMeridianDeskLane(): Promise<MeridianDeskLane> {
  const desk = await loadSpxDesk().catch(() => null);
  return {
    net_flow_by_expiry: desk?.net_flow_by_expiry ?? [],
    greek_exposure: desk?.greek_exposure ?? null,
  };
}
