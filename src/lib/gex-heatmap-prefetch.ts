/**
 * Client-side warm-start for Thermal triple grid — fires parallel cache-reader GETs
 * and seeds sessionStorage so SWR fallbackData paints instantly on Grid open.
 */
import { isUsableGexHeatmapPayload } from "@/features/thermal/lib/thermal-desk-state";
import { writeGexHeatmapSessionCache } from "@/lib/gex-heatmap-session-cache";

export async function fetchGexHeatmapForPrefetch(ticker: string): Promise<unknown | null> {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  const res = await fetch(`/api/market/gex-heatmap?ticker=${encodeURIComponent(t)}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) return null;
  return res.json();
}

/** Fire-and-forget parallel prefetch for compare-grid tickers. */
export function prefetchGexHeatmapTickers(tickers: readonly string[]): void {
  if (typeof window === "undefined") return;
  for (const ticker of tickers) {
    void fetchGexHeatmapForPrefetch(ticker)
      .then((payload) => {
        if (isUsableGexHeatmapPayload(payload as Parameters<typeof isUsableGexHeatmapPayload>[0])) {
          writeGexHeatmapSessionCache(ticker, payload);
        }
      })
      .catch(() => {
        /* best-effort */
      });
  }
}
