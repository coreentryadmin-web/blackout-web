"use client";

import { useMemo } from "react";
import {
  VECTOR_GEX_HEATMAP_POLL_MS,
  VECTOR_SPY_VOLUME_BACKFILL_MS,
} from "@/features/vector/lib/vector-cadence";
import type { VectorIndicatorId } from "@/features/vector/lib/vector-indicators-config";

type Args = {
  ticker: string;
  liveSession: boolean;
  wallTrailSec: number;
  indicators: Set<VectorIndicatorId>;
};

/** Central poll cadence map for Vector live surfaces — single source for chart + shell consumers. */
export function useVectorLivePoll({
  ticker,
  liveSession,
  wallTrailSec,
  indicators,
}: Args) {
  return useMemo(
    () => ({
      scopePollMs: wallTrailSec * 1000,
      gexHeatmapPollMs: VECTOR_GEX_HEATMAP_POLL_MS,
      flowPollMs: liveSession && indicators.has("flow-markers") ? 15_000 : null,
      spyVolumePollMs: ticker === "SPX" && liveSession ? VECTOR_SPY_VOLUME_BACKFILL_MS : null,
      pinPollMs: ticker === "SPX" && liveSession ? 5_000 : null,
    }),
    [ticker, liveSession, wallTrailSec, indicators]
  );
}
