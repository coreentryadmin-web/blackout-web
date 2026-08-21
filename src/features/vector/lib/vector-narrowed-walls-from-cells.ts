import { sumMetricCellsForExpiries } from "@/lib/gex-shift-scope";
import { expiriesForHorizon, type VectorDteHorizon } from "./vector-dte-horizon";

/**
 * Narrowed-horizon strike totals derived from the matrix the caller ALREADY HAS.
 *
 * WHY THIS EXISTS: the 0DTE / weekly / monthly bead rails were recorded only by a 5-minute cron and
 * by whoever happened to be viewing a ticker, so every un-viewed name showed ~300s holes in its
 * trail (measured 2026-08-17: SPY's 0DTE rail had 56 samples over 90 minutes with 17 gaps of ~300s,
 * against 586 samples on SPX). They were pulled off the 5s universe sweep for a real reason —
 * `buildNarrowedHorizonWallSamples` costs SIX scoped upstream reads per ticker (three horizons ×
 * walls + flip), which measured 56s for an 83-ticker slice and blew the sweep's 5s tick budget,
 * dropping ticks and thinning the blended rail for everyone.
 *
 * The insight that makes full density affordable: the sweep already fetched the WHOLE matrix for
 * this ticker in one `fetchGexHeatmap` call, and that matrix carries per-expiry `cells`. A narrowed
 * horizon is just a SUBSET OF EXPIRY COLUMNS. Summing the columns we already hold is pure
 * arithmetic over an in-memory object — no network, no cache, no provider — so the three narrowed
 * rails cost effectively nothing and can record at the same 5s cadence as the blended rail.
 *
 * This is the same reduction `computeGexWalls` already performs on `strike_totals`; the only
 * difference is which expiry columns are summed. Blended totals = every column, so passing the
 * "all" horizon through here reproduces the existing blended rail exactly.
 */
export function strikeTotalsForHorizonFromCells(
  cells: Record<string, Record<string, number>> | undefined,
  allExpiries: readonly string[] | undefined,
  horizon: VectorDteHorizon,
  todayYmd: string
): Map<number, number> | null {
  if (!cells || !allExpiries?.length) return null;

  const scoped = expiriesForHorizon(allExpiries, horizon, todayYmd);
  if (!scoped.length) return null;

  const out = new Map<number, number>();
  for (const [strikeKey, row] of Object.entries(cells)) {
    const strike = Number(strikeKey);
    if (!Number.isFinite(strike)) continue;
    const total = sumMetricCellsForExpiries(row, scoped);
    // A strike with zero net gamma in this horizon is NOT a wall — dropping it keeps the narrowed
    // rail's wall ranking honest rather than padding it with flat strikes that only exist because
    // they carry weight in some OTHER expiry.
    if (total !== 0) out.set(strike, total);
  }
  return out.size ? out : null;
}
