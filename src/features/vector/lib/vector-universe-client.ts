"use client";

import useSWR, { type SWRConfiguration, type SWRResponse } from "swr";
import type { VectorUniverseSnapshot } from "./vector-universe";

/** Shared SWR key for the universe scanner snapshot — every consumer MUST use this exact key
 *  (not a fresh string literal) so SWR dedupes concurrent polls into one fetch/interval instead
 *  of each mounted component running its own independent loop against the same endpoint. */
export const VECTOR_UNIVERSE_SWR_KEY = "vector-universe";

export async function fetchVectorUniverseSnapshot(): Promise<VectorUniverseSnapshot> {
  const res = await fetch("/api/market/vector/universe", { cache: "no-store" });
  if (!res.ok) throw new Error("universe fetch failed");
  return res.json();
}

/**
 * Shared subscription to `GET /api/market/vector/universe` (the scanner's per-ticker
 * regime/wall snapshot). Extracted out of VectorScanner so a second consumer (e.g.
 * VectorTickerComparisonStrip) reuses the SAME SWR cache entry — same key, same fetcher —
 * rather than opening a second poll against the same read-through Redis snapshot.
 */
export function useVectorUniverseSnapshot(
  config?: SWRConfiguration<VectorUniverseSnapshot>
): SWRResponse<VectorUniverseSnapshot> {
  return useSWR(VECTOR_UNIVERSE_SWR_KEY, fetchVectorUniverseSnapshot, {
    refreshInterval: 5_000,
    revalidateOnFocus: true,
    ...config,
  });
}
