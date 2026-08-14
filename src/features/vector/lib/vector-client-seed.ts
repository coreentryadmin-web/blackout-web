"use client";

import type { VectorBar } from "@/features/vector/components/VectorChart";
import type { VectorDarkPoolLevel, VectorWalls } from "@/lib/api";
import type { WallHistorySample } from "@/features/vector/lib/vector-wall-history";
import { seedWallHistoryForDisplay } from "@/features/vector/lib/vector-wall-history";
import { VECTOR_ORACLE_TICKERS } from "@/features/vector/lib/vector-ticker";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { isHeatmapOverlayAllowed } from "@/lib/heatmap-allowlist";

export type VectorClientSeed = {
  ticker: string;
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
  initialVexWalls: VectorWalls | null;
  initialWallHistory: WallHistorySample[];
  initialHorizonWallHistory: WallHistorySample[];
  initialGammaFlip: number | null;
  initialVexFlip: number | null;
  initialDarkPoolLevels: VectorDarkPoolLevel[];
  sessionYmd: string;
  liveSession: boolean;
  initialWallTrailSec: number;
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Client-side seed for ticker switches — avoids full SSR on every VectorTickerSelect navigation. */
export async function fetchVectorClientSeed(ticker: string): Promise<VectorClientSeed> {
  const t = encodeURIComponent(ticker);
  const barsPayload = await fetchJson<{ bars?: VectorBar[]; sessionYmd?: string }>(
    `/api/market/vector/bars?ticker=${t}`
  );
  const sessionYmd = barsPayload?.sessionYmd ?? todayEtYmd();
  const horizon = VECTOR_ORACLE_TICKERS.has(ticker) ? "0dte" : "all";
  const [wallsPayload, historyPayload, horizonHistory] = await Promise.all([
    fetchJson<{ walls?: VectorWalls; flip?: number | null }>(
      `/api/market/vector/walls?ticker=${t}&dte=all`
    ),
    fetchJson<{ history?: WallHistorySample[] }>(
      `/api/market/vector/wall-history?ticker=${t}&dte=all&session=${encodeURIComponent(sessionYmd)}`
    ),
    horizon !== "all"
      ? fetchJson<{ history?: WallHistorySample[] }>(
          `/api/market/vector/wall-history?ticker=${t}&dte=${horizon}&session=${encodeURIComponent(sessionYmd)}`
        )
      : Promise.resolve(null),
  ]);

  return {
    ticker,
    initialBars: barsPayload?.bars ?? [],
    initialWalls: wallsPayload?.walls ?? null,
    initialVexWalls: null,
    initialWallHistory: seedWallHistoryForDisplay(
      historyPayload?.history ?? [],
      (barsPayload?.bars ?? []).map((b) => b.time),
      wallsPayload?.walls ?? null,
      wallsPayload?.flip ?? null,
      null,
      null
    ),
    initialHorizonWallHistory: horizonHistory?.history ?? [],
    initialGammaFlip: wallsPayload?.flip ?? null,
    initialVexFlip: null,
    initialDarkPoolLevels: [],
    sessionYmd,
    liveSession: sessionYmd === todayEtYmd(),
    initialWallTrailSec: isHeatmapOverlayAllowed(ticker) ? 5 : 15,
  };
}
