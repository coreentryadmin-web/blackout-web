/**
 * CATALYST Tier-0 screen — market-wide Benzinga earnings window (V2 P2).
 *
 * Reuses Meridian's cached Benzinga bundle (no per-ticker UW fan-out). Full news-impulse
 * scan is deferred to Tier-1 enrich (swing-ingest catalyst fetchers).
 */

import { loadBenzingaEarningsBundle } from "@/lib/meridian/meridian-benzinga-earnings";
import {
  screenCatalystFromEarningsRows,
  SWING_CATALYST_EARNINGS_AHEAD_DAYS,
  type CatalystOriginCandidate,
} from "./catalyst";

/** Screen catalyst-origin candidates from the shared Benzinga earnings window. */
export async function screenCatalystFromBenzingaBundle(
  todayYmd: string,
): Promise<CatalystOriginCandidate[]> {
  const bundle = await loadBenzingaEarningsBundle(todayYmd, SWING_CATALYST_EARNINGS_AHEAD_DAYS).catch(
    () => ({ window_rows: [] as const }),
  );
  return screenCatalystFromEarningsRows(bundle.window_rows ?? [], todayYmd);
}

/** Tickers admitted by CATALYST origin (for Tier-0 merge). */
export async function catalystTickersFromBenzingaBundle(todayYmd: string): Promise<string[]> {
  const hits = await screenCatalystFromBenzingaBundle(todayYmd);
  return hits.map((h) => h.ticker);
}
