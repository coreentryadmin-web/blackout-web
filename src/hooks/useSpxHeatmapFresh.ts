"use client";

import useSWR from "swr";
import { readGexHeatmapSessionCache } from "@/lib/gex-heatmap-session-cache";

const MATRIX_KEY = "/api/market/gex-heatmap?ticker=SPX";

type GexHeatmapPayload = {
  available?: boolean;
  gex?: { strike_totals?: Record<string, number> };
};

async function fetchGexHeatmap(url: string): Promise<GexHeatmapPayload> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`gex-heatmap ${res.status}`);
  return res.json() as Promise<GexHeatmapPayload>;
}

/** True when the client-side heatmap SWR lane has a populated GEX matrix. */
export function useSpxHeatmapFresh(): boolean {
  const { data } = useSWR<GexHeatmapPayload>(MATRIX_KEY, fetchGexHeatmap, {
    refreshInterval: 8_000,
    refreshWhenHidden: false,
    revalidateOnFocus: false,
    keepPreviousData: true,
    fallbackData: readGexHeatmapSessionCache<GexHeatmapPayload>("SPX"),
  });
  return Boolean(data?.available && Object.keys(data?.gex?.strike_totals ?? {}).length > 0);
}
