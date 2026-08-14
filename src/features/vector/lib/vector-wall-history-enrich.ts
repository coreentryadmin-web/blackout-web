import "server-only";

import type { VectorBar } from "@/features/vector/components/VectorChart";
import { lastSessionBars } from "@/features/vector/lib/vector-key-levels";
import { reconstructSessionRail } from "@/features/vector/lib/vector-gex-reconstruct-server";
import { getVectorWallHistory } from "@/features/vector/lib/vector-snapshot";
import {
  backfillRailGaps,
  decimateSeedHistory,
  mergeWallHistory,
  railUncoveredSec,
  RAIL_GAP_FILL_MIN_SEC,
  RAIL_RECONSTRUCT_MIN_UNCOVERED_SEC,
  trimHistoryToSession,
  type WallHistorySample,
} from "@/features/vector/lib/vector-wall-history";

export type EnrichSessionWallHistoryOpts = {
  ticker: string;
  sessionYmd: string;
  persistedHistory: WallHistorySample[];
  bars: VectorBar[];
  /** Merge in-process recorder samples (SSR / stream-serving tier). Default true. */
  mergeLiveMemory?: boolean;
  /** Apply decimateSeedHistory for transport size. Default true. */
  decimate?: boolean;
};

/**
 * Observed-rail merge + modeled gap-fill — the same pipeline as SSR `loadVectorSeedProps`, shared
 * with `/api/market/vector/wall-history` so soft ticker switches and Compare panes are not stuck
 * on raw Redis rows with recorder holes.
 */
export async function enrichSessionWallHistory(
  opts: EnrichSessionWallHistoryOpts
): Promise<WallHistorySample[]> {
  const {
    ticker,
    sessionYmd,
    persistedHistory,
    bars,
    mergeLiveMemory = true,
    decimate = true,
  } = opts;

  const observed = mergeLiveMemory
    ? mergeWallHistory(getVectorWallHistory(ticker), persistedHistory)
    : persistedHistory;

  const sessionBars = lastSessionBars(bars);
  const firstBar = sessionBars[0]?.time;
  const lastBar = sessionBars[sessionBars.length - 1]?.time;
  if (!sessionBars.length || firstBar == null || lastBar == null) {
    const scoped = trimHistoryToSession(observed, firstBar);
    return decimate ? decimateSeedHistory(scoped) : scoped;
  }

  const uncoveredSec = railUncoveredSec(observed, firstBar, lastBar, RAIL_GAP_FILL_MIN_SEC);
  const modeledRail =
    uncoveredSec > RAIL_RECONSTRUCT_MIN_UNCOVERED_SEC
      ? await reconstructSessionRail({ ticker, sessionYmd }).catch(() => [] as WallHistorySample[])
      : [];

  const backfilled = backfillRailGaps(
    observed,
    modeledRail,
    firstBar,
    lastBar,
    RAIL_GAP_FILL_MIN_SEC
  );
  const sessionScoped = trimHistoryToSession(backfilled, firstBar);
  return decimate ? decimateSeedHistory(sessionScoped) : sessionScoped;
}
