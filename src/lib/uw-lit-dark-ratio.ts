import type { DarkPoolSnapshot } from "@/lib/providers/unusual-whales";
import { isWsUpdatedAtFresh } from "@/lib/ws/timestamp-freshness";
import { darkPoolStore, litTradesStore } from "@/lib/ws/uw-socket";

export type LitDarkRatio = {
  lit_premium: number;
  dark_premium: number;
  lit_share: number | null;
  updated_at: number;
};

const LIT_DARK_MAX_AGE_MS = 120_000;

/** Age (ms) of the freshest print in a dark-pool snapshot, or null if there is none to date. */
function latestPrintAgeMs(darkPool: DarkPoolSnapshot | null | undefined, now: number): number | null {
  if (!darkPool?.prints?.length) return null;
  let latest = 0;
  for (const p of darkPool.prints) {
    const t = Date.parse(p.executed_at);
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  return latest > 0 ? now - latest : null;
}

/**
 * Lit vs dark premium share from UW WS stores (SPY lit tape + dark pool snapshot).
 *
 * BUG FIX (2026-10-06, 5-engine/Ask Largo live monitor): this always read dark-pool freshness
 * from `darkPoolStore.updatedAt` alone — the raw WS channel's own last-tick clock. But the SPX
 * desk's own `resolveDarkPool()` (spx-desk.ts) is WS-first with THREE fallbacks (Redis-bridge
 * cache, an in-process cache, then a REST fetch) precisely because the raw WS lane can sit dead
 * while the desk still serves genuinely live dark-pool data through one of those fallbacks — live
 * repro: `desk.dark_pool.prints[0].executed_at` measured consistently <150s old across three
 * consecutive checks while `lit_dark_ratio` stayed `null` every time, because `darkPoolStore`
 * (checked only by this function, not by `resolveDarkPool`'s own freshness gate) was never
 * refreshed. The result: a metric that reads "unavailable" even when the exact data members
 * already see on the desk is live. Accepting the caller's own already-resolved snapshot and
 * checking ITS freshest print's own timestamp (not a second, disconnected store) closes that gap
 * without weakening the freshness bar — a 2-hour-old REST snapshot still correctly reads stale.
 */
export function computeLitDarkRatio(resolvedDarkPool?: DarkPoolSnapshot | null): LitDarkRatio | null {
  const now = Date.now();
  const litFresh = isWsUpdatedAtFresh(litTradesStore.updatedAt, LIT_DARK_MAX_AGE_MS, now);
  const darkStoreFresh = isWsUpdatedAtFresh(darkPoolStore.updatedAt, LIT_DARK_MAX_AGE_MS, now);
  const resolvedAgeMs = resolvedDarkPool !== undefined ? latestPrintAgeMs(resolvedDarkPool, now) : null;
  const resolvedFresh = resolvedAgeMs != null && resolvedAgeMs <= LIT_DARK_MAX_AGE_MS;
  const darkFresh = darkStoreFresh || resolvedFresh;
  if (!litFresh && !darkFresh) return null;

  let litPremium = 0;
  if (litFresh) {
    for (const row of litTradesStore.rows) {
      if (row.symbol === "SPY" || row.symbol === "SPX") litPremium += row.premium;
    }
  }
  let darkPremium = 0;
  const darkPool: DarkPoolSnapshot | null = resolvedFresh
    ? (resolvedDarkPool ?? null)
    : (darkStoreFresh ? darkPoolStore.data : null);
  if (darkFresh && darkPool) {
    darkPremium = Number.isFinite(darkPool.total_premium) ? darkPool.total_premium : 0;
    if (darkPremium <= 0 && darkPool.prints?.length) {
      for (const p of darkPool.prints) {
        darkPremium += Number(p.premium ?? 0);
      }
    }
  }
  const total = litPremium + darkPremium;
  return {
    lit_premium: litPremium,
    dark_premium: darkPremium,
    lit_share: total > 0 ? litPremium / total : null,
    updated_at: Math.max(litTradesStore.updatedAt, darkPoolStore.updatedAt),
  };
}
