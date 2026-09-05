/**
 * Batch halt/LULD read for Swing V2 commit gating (G-S12).
 * Mirrors zerodte/scan.ts halt batch — per-ticker ACTIVE halt + global feed-stale flag.
 */

/** Read ACTIVE halts per ticker (failClosedOnStale:false) and whether the halt FEED is cold. */
export async function readSwingHaltStateForTickers(
  tickers: readonly string[],
): Promise<{ active: Set<string>; feedStale: boolean }> {
  if (tickers.length === 0) return { active: new Set(), feedStale: false };
  try {
    // Relative import so test mocks on ../ws/uw-socket resolve consistently (see zerodte/scan.ts).
    const { shouldBlockForTradingHalt, isTradingHaltChannelStale, warmUwClusterFreshnessFromRedis } =
      await import("../../ws/uw-socket");
    await warmUwClusterFreshnessFromRedis();
    const active = new Set<string>();
    for (const t of tickers) {
      const sym = t.trim().toUpperCase();
      if (!sym) continue;
      if (shouldBlockForTradingHalt([sym], { failClosedOnStale: false }).block) active.add(sym);
    }
    return { active, feedStale: isTradingHaltChannelStale() };
  } catch {
    return { active: new Set(), feedStale: false };
  }
}
