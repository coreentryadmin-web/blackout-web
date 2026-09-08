/**
 * BANGER Tier-0 origin (Swing Engine V2 P3/O5) — whole-market banger screen.
 *
 * Reuses screenBangerMovers (Engine B) as an independent discovery origin, not serve-time merge.
 * Zero-cap faithful port — every qualifying row is admitted (see banger/discovery.ts header).
 */

import { screenBangerMovers, type GroupedDailyRow } from "@/lib/banger/discovery";

/** Tickers admitted by the BANGER origin from grouped-daily bars. */
export function bangerTickersFromGroupedDaily(rows: readonly GroupedDailyRow[]): string[] {
  return screenBangerMovers(rows).map((m) => m.ticker);
}
