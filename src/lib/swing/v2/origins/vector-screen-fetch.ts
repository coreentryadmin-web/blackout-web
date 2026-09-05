/**
 * VECTOR Tier-0 IO — vector_pick_leaders fetch for swing discovery cron.
 */

import { fetchVectorPickLeaderRows } from "@/lib/vector/vector-pick-leaders-db";
import { vectorTickersFromLeaderRows } from "./vector-screen";

/** Top Vector leader tickers for Tier-0 merge. */
export async function vectorTickersFromPickLeaders(opts?: {
  sessionDate?: string | null;
  limit?: number;
}): Promise<string[]> {
  const rows = await fetchVectorPickLeaderRows({
    sessionDate: opts?.sessionDate ?? null,
    limit: opts?.limit ?? 80,
  }).catch(() => []);
  return vectorTickersFromLeaderRows(rows, opts?.limit ?? 80);
}
