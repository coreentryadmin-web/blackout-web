/**
 * Client-side warm-start for the Thermal compare grid — parallel cache-reader GETs seed
 * sessionStorage so SWR fallbackData paints every column together on open.
 */
import { isUsableGexHeatmapPayload } from "@/features/thermal/lib/thermal-desk-state";
import {
  readGexHeatmapSessionCache,
  writeGexHeatmapSessionCache,
} from "@/lib/gex-heatmap-session-cache";

export async function fetchGexHeatmapForPrefetch(
  ticker: string,
  signal?: AbortSignal
): Promise<unknown | null> {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  const res = await fetch(`/api/market/gex-heatmap?ticker=${encodeURIComponent(t)}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    signal,
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * The batch currently in flight. Each call supersedes the previous one.
 *
 * WHY: the sector picker offers 8 presets of 5 names each, and a member scanning the dropdown
 * changes preset far faster than a heatmap build completes. Without this, every superseded preset
 * keeps its 5 requests running to completion AND still writes sessionStorage on arrival — so a
 * member who lands on Energy can have Semis/AI/Space payloads overwrite the cache behind them, and
 * the server eats up to 40 concurrent banded-chain builds for one member's dropdown scroll. Abort
 * on supersede: only the preset actually being looked at gets to spend the budget or seed a cell.
 */
let inFlight: AbortController | null = null;

/** Fire-and-forget parallel prefetch for compare-grid tickers. Supersedes any previous batch. */
export function prefetchGexHeatmapTickers(tickers: readonly string[]): void {
  if (typeof window === "undefined") return;

  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  for (const ticker of tickers) {
    // Already warm — the column will paint from fallbackData, so spending a request here buys
    // nothing. The per-entry TTL in gex-heatmap-session-cache is what keeps this from serving
    // something stale.
    if (readGexHeatmapSessionCache(ticker) !== undefined) continue;

    void fetchGexHeatmapForPrefetch(ticker, controller.signal)
      .then((payload) => {
        // A superseded batch must not seed the cache even if its response beat the abort.
        if (controller.signal.aborted) return;
        if (isUsableGexHeatmapPayload(payload as Parameters<typeof isUsableGexHeatmapPayload>[0])) {
          writeGexHeatmapSessionCache(ticker, payload);
        }
      })
      .catch(() => {
        /* best-effort — an AbortError here is the intended path, not a failure */
      });
  }
}

/** Test seam: drop the in-flight batch reference between cases. */
export function __test_resetGexHeatmapPrefetch(): void {
  inFlight?.abort();
  inFlight = null;
}
