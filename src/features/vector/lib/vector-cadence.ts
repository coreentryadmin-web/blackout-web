/** Vector live-data cadence — single source of truth for client + server tuning. */

/** SSE hub tick — spot + forming candle for every ticker. */
export const VECTOR_SPOT_TICK_MS = 1_000;

/** Wall bead trail sample + display bucket (live RTH). */
export const VECTOR_WALL_TRAIL_SEC = 5;

/** Scoped DTE walls + wall-history REST poll (client). */
export const VECTOR_WALLS_SCOPE_POLL_MS = 5_000;

/** Reconstructed GEX heatmap client poll during live session. */
export const VECTOR_GEX_HEATMAP_POLL_MS = 5_000;

/** Redis TTL for vector strike×time heatmap (server). */
export const VECTOR_GEX_HEATMAP_CACHE_SEC = 5;

/** Refetch heatmap when spot moves more than this fraction vs last fetch. */
export const VECTOR_GEX_HEATMAP_FAST_MOVE_PCT = 0.005;

/** Server wall-scope / heatmap fallback refresh. */
export const VECTOR_WALL_SCOPE_REFRESH_MS = 5_000;
