import "server-only";

import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { normalizeVectorTicker } from "./vector-ticker";
import { loadCurrentChainContracts } from "./vector-gex-reconstruct-server";
import { maxPainForHorizon } from "./vector-max-pain";
import type { VectorDteHorizon } from "./vector-dte-horizon";

/**
 * Horizon-scoped max-pain for a ticker — the server shell behind the Vector max-pain read. Reuses
 * the SAME spot + cached banded chain the per-expiry GEX walls already fetch (loadCurrentChain
 * contracts is Redis-cached 10min), then runs the pure `maxPainForHorizon`. Max pain itself only
 * needs open interest by strike — the spot is fetched solely to band the chain fetch, and is
 * returned so the caller can place the level relative to price.
 *
 * 0DTE single-source: when the shared heatmap/positioning already has a front-expiry max_pain
 * (same field the SPX desk + Thermal matrix show), prefer it over a parallel chain recompute so
 * the Vector confluence level cannot disagree with the desk header on the same page. Wider
 * horizons (weekly/monthly/all) still compute from the horizon-scoped chain.
 *
 * Best-effort: returns null on any failure (no spot, empty chain, empty horizon, thrown fetch) — a
 * live overlay must degrade to "no line" rather than error or blank the chart.
 */
export async function getVectorMaxPainForHorizon(
  ticker: string,
  horizon: VectorDteHorizon
): Promise<{ maxPain: number; spot: number } | null> {
  const t = normalizeVectorTicker(ticker);
  try {
    const pos = await getGexPositioning(t);
    const spot = pos?.spot;
    if (!(spot && spot > 0)) return null;

    // Desk/heatmap max_pain is front-expiry scoped — identical question to Vector 0DTE.
    if (
      horizon === "0dte" &&
      pos.max_pain != null &&
      Number.isFinite(pos.max_pain) &&
      pos.max_pain > 0
    ) {
      return { maxPain: pos.max_pain, spot };
    }

    const contracts = await loadCurrentChainContracts(t, spot);
    if (!contracts.length) return null;
    const res = maxPainForHorizon(contracts, horizon, todayEtYmd());
    if (!res) return null;
    return { maxPain: res.maxPain, spot };
  } catch {
    return null; // live overlay: fall back to no line, never throw
  }
}
