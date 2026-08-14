"use client";

/**
 * Deduped client fetch for `/api/market/vector/gex-heatmap` — VectorPageShell's shift-leaders
 * strip and VectorChart's background heatmap both hit this route; coalesce concurrent in-flight
 * requests for the same ticker+horizon so a ticker switch doesn't double the upstream work.
 */
type GexHeatmapPayload = {
  gex?: { strike_totals?: Record<string, number> };
  shift?: { available?: boolean; delta_by_strike?: Record<string, number> };
};

const inflight = new Map<string, Promise<GexHeatmapPayload | null>>();
const cache = new Map<string, { at: number; data: GexHeatmapPayload | null }>();
const CACHE_MS = 4_000;

export async function fetchVectorGexHeatmapDeduped(
  ticker: string,
  dteHorizon = "all"
): Promise<GexHeatmapPayload | null> {
  const key = `${ticker}:${dteHorizon}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const qs =
        dteHorizon && dteHorizon !== "all"
          ? `&dte=${encodeURIComponent(dteHorizon)}`
          : "";
      const res = await fetch(
        `/api/market/vector/gex-heatmap?ticker=${encodeURIComponent(ticker)}${qs}`,
        { cache: "no-store" }
      );
      const data = res.ok ? ((await res.json()) as GexHeatmapPayload) : null;
      cache.set(key, { at: Date.now(), data });
      return data;
    } catch {
      cache.set(key, { at: Date.now(), data: null });
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

/** Test-only reset. */
export function _resetVectorGexHeatmapClientForTest(): void {
  inflight.clear();
  cache.clear();
}
