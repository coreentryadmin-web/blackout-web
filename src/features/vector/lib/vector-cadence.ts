/** Vector live-data cadence — single source of truth for client + server tuning. */

import { isHeatmapOverlayAllowed } from "@/lib/heatmap-allowlist";
import { VECTOR_ORACLE_TICKERS, normalizeVectorTicker } from "./vector-ticker";

/** SSE hub tick — spot + forming candle for every ticker. */
export const VECTOR_SPOT_TICK_MS = 1_000;

/** Wall bead trail sample — shared universe + oracle names (server + client). */
export const VECTOR_WALL_TRAIL_SEC = 5;

/** Wall bead trail sample — any non-oracle ticker outside the always-on universe recorder. */
export const VECTOR_NON_UNIVERSE_WALL_TRAIL_SEC = 15;

/** Scoped DTE walls + wall-history REST poll — oracle / universe names. */
export const VECTOR_WALLS_SCOPE_POLL_MS = 5_000;

/** Scoped DTE walls + wall-history REST poll — non-oracle on-demand tickers. */
export const VECTOR_NON_UNIVERSE_WALLS_SCOPE_POLL_MS = 15_000;

/** Reconstructed GEX heatmap client poll during live session. */
export const VECTOR_GEX_HEATMAP_POLL_MS = 5_000;

/** SPY share-volume backfill poll for SPX chart proxy. */
export const VECTOR_SPY_VOLUME_BACKFILL_MS = 60_000;

/** Redis TTL for vector strike×time heatmap (server). */
export const VECTOR_GEX_HEATMAP_CACHE_SEC = 5;

/** Refetch heatmap when spot moves more than this fraction vs last fetch. */
export const VECTOR_GEX_HEATMAP_FAST_MOVE_PCT = 0.005;

/** Compare 4-up: background panes poll overlays at 2× the normal cadence. */
export const VECTOR_COMPARE_FOUR_UP_POLL_MULTIPLIER = 2;

/**
 * Compare-mode defaults, deliberately different from the full-size desk.
 *
 * A compare grid is four charts at roughly a quarter the height each. The desk defaults were tuned
 * for one full-height chart: at that size AUTO's 10-20 rows read fine, and a 3m candle has room to
 * breathe. Reused as-is in a quarter pane they crowd the rail into a solid block and leave too few
 * candles to compare shapes across tickers, which is the entire job of the mode.
 *
 * 8 rows and 5m candles are the pane-sized equivalents. Members can still change both per pane.
 */
export const VECTOR_COMPARE_NODE_DENSITY = 8;
export const VECTOR_COMPARE_DEFAULT_TIMEFRAME = 5;

/** Compare 4-up: minimum ms between live-tick overlay repaints on background panes. */
export const VECTOR_COMPARE_FOUR_UP_OVERLAY_REFRESH_MS = 2_000;

/** Scale a live poll interval when a compare pane is an unfocused 4-up background chart. */
export function vectorComparePerfPollMs(baseMs: number, backgroundPane: boolean): number {
  if (!backgroundPane || !Number.isFinite(baseMs) || baseMs <= 0) return baseMs;
  return Math.round(baseMs * VECTOR_COMPARE_FOUR_UP_POLL_MULTIPLIER);
}

/** Server wall-scope / heatmap fallback refresh — oracle path. */
export const VECTOR_WALL_SCOPE_REFRESH_MS = 5_000;

/** Server wall-scope refresh for non-oracle on-demand tickers. */
export const VECTOR_NON_UNIVERSE_WALL_SCOPE_REFRESH_MS = 15_000;

/** Client poll cadence for scoped walls / horizon history. */
export function vectorWallsScopePollMs(ticker?: string | null): number {
  if (!ticker) return VECTOR_NON_UNIVERSE_WALLS_SCOPE_POLL_MS;
  const t = normalizeVectorTicker(ticker);
  if (VECTOR_ORACLE_TICKERS.has(t) || isHeatmapOverlayAllowed(t)) {
    return VECTOR_WALLS_SCOPE_POLL_MS;
  }
  return VECTOR_NON_UNIVERSE_WALLS_SCOPE_POLL_MS;
}
