// NOTE: intentionally NOT `import "server-only"`. This is a pure data + predicate module (preset
// ticker list + allowlist checks, no secrets / no server APIs), imported by polygon-options-gex which
// the valuation test suite pulls in under tsx/node — where `server-only` throws ("cannot be imported
// from a Client Component"). It's test- and client-safe like tool-access.ts; the UW-budget gating it
// supports is enforced in the server route, not by this leaf's import guard.

// ---------------------------------------------------------------------------
// Heat Maps server-side allowlist.
//
// THE POINT: the gex-heatmap route's UW overlays (flow-per-strike + dark-pool)
// are the only part of the heatmap that touches Unusual Whales — and UW is capped
// at 2 RPS CLUSTER-WIDE (shared by the desk / Largo / Night Hawk / HELIX). The
// matrix itself is a pure Polygon cache-reader and is fine for ANY ticker, but
// fetching UW overlays for ANY 8-char-regex symbol means 1000 users on 1000
// distinct tickers would each mint a fresh UW overlay fetch and starve the budget.
//
// So overlays are gated to a SMALL, KNOWN-LIQUID allowlist (the heatmap preset
// chips + a handful of liquid names). Off-allowlist tickers still get the full
// dealer-gamma matrix — they just serve the overlay-free contract (matrix only),
// exactly the same shape `gex-positioning` already returns for every consumer.
//
// The set is GLOBAL (never per-user) so the route stays a cache-reader: warming /
// caching keys on these constants, never on caller identity.
// ---------------------------------------------------------------------------

/**
 * The ~11 heatmap preset chips surfaced in the UI (src/features/thermal/components/GexHeatmap.tsx
 * `PRESET_TICKERS`). Kept in sync MANUALLY — these are the names the warm cron batches
 * and the only symbols whose UW overlays are pre-warmed. SPX index options resolve to
 * I:SPX upstream but the user-facing ticker key is "SPX".
 */
export const HEATMAP_PRESET_TICKERS = [
  "SPY",
  "SPX",
  "QQQ",
  "IWM",
  "NVDA",
  "TSLA",
  "AAPL",
  "AMD",
  "META",
  "AMZN",
  "GOOGL",
] as const;

/**
 * Additional known-liquid names allowed to fetch UW overlays beyond the preset chips.
 * These are heavily-traded, deep-options-chain symbols where the overlay budget spend
 * is worth it. Off-list symbols still get the full matrix, overlay-free.
 *
 * MEASURED UW CEILING (2026-08-13, live probe against the production key):
 *   sustained 2/s -> 12/12 200    4/s -> 24/24 200    6/s -> 36/36 200    8/s -> 11 OK / 37x 503
 *   burst concurrency: 4 concurrent all 200; 8 concurrent -> 5x 429; 12 -> 9x 429
 * So UW sustains ~6 req/s and sheds (503) above it, and rejects bursts past ~4 in flight.
 * UW publishes no rate-limit headers and no documented number — this was established
 * empirically; re-measure before treating it as fixed.
 *
 * Our own ceiling is `UW_GLOBAL_MAX_RPS` (default 2) in uw-rate-limiter.ts — a CLUSTER-WIDE
 * Redis-enforced cap, i.e. we deliberately run at ~1/3 of measured upstream capacity. That
 * headroom is why the sector-grid names below are affordable.
 */
const HEATMAP_EXTRA_LIQUID_TICKERS = [
  "MSFT",
  "GOOG",
  "NFLX",
  "NDX",
  "DIA",
  "GLD",
  "TLT",
  "COIN",
  "MSTR",
  "SMH",
  // Heavily-traded retail options names. Being on this list also puts them in the recorded Vector
  // universe (vectorUniverseTickers → the 5-min wall-history recorder cron), so their bead rail
  // accumulates from the session open instead of only forward-building from a member's first view —
  // the fix for "ASTS only shows single beads" (an unrecorded ticker has no intraday trail to seed,
  // so seedWallHistoryForDisplay honestly draws one dot per wall at the last bar).
  "ASTS",

  // ── Thermal sector-grid presets (#2137) ───────────────────────────────────────────────────
  // Every remaining name across the 8 sector presets in features/thermal/lib/thermal-compare-presets.
  // Without these, four whole presets (Space, Energy, Financials, Biotech) were 0/5 covered, so all
  // five columns showed the overlay chip in its "not offered" state permanently — technically honest
  // but a poor read of a shipped feature.
  //
  // COST: overlays are cached 30s server-side, in-memory + Redis, SHARED across every member
  // (gex-heatmap/route.ts OVERLAY_TTL_MS). So the spend is 2 REST calls per ticker per 30s
  // CLUSTER-WIDE, not per user — a member sitting on one 5-name preset costs ~0.33 req/s, and all
  // 8 presets being viewed at once costs ~2.7 req/s. Both sit under the ~6/s measured ceiling.
  // Membership here does NOT change what a member can see: /api/market/gex-heatmap serves the full
  // dealer-gamma matrix for any valid ticker regardless — this only gates the UW overlay spend.
  //
  // Sorted by preset for auditability against thermal-compare-presets.ts. Names already listed
  // above (NVDA/AMD/AAPL/META/AMZN/MSFT/COIN/MSTR + presets) are deliberately not repeated.
  "AVGO", "MU", "SMCI",            // semis
  "PLTR", "ARM",                   // ai
  "RKLB", "LUNR", "BA", "PL",      // space (ASTS already above)
  "HOOD", "MARA", "RIOT",          // crypto
  "XOM", "CVX", "OXY", "SLB", "COP",   // energy
  "JPM", "GS", "BAC", "MS", "V",       // financials
  "LLY", "UNH", "MRK", "ABBV", "GILD", // biotech
] as const;

/** Normalized allowlist set (uppercased) — overlays fetch ONLY for these symbols. */
const ALLOWLIST = new Set<string>([
  ...HEATMAP_PRESET_TICKERS,
  ...HEATMAP_EXTRA_LIQUID_TICKERS,
]);

/**
 * True when `ticker` is on the heatmap overlay allowlist (preset chip or known-liquid
 * name). Off-allowlist symbols still get the full dealer-gamma matrix — they just skip
 * the UW overlay fetch and serve the matrix-only contract. Input is normalized
 * (trimmed/uppercased) to match the route's ticker key.
 */
export function isHeatmapOverlayAllowed(ticker: string): boolean {
  const root = String(ticker ?? "").trim().toUpperCase();
  return root.length > 0 && ALLOWLIST.has(root);
}

/** The preset tickers as a plain array (warm-cron batch source). */
export function heatmapPresetTickers(): string[] {
  return [...HEATMAP_PRESET_TICKERS];
}

/** Full overlay allowlist — Vector universe + dark-pool warm batch (~21 names). */
export function vectorUniverseTickers(): string[] {
  return [...ALLOWLIST];
}

/**
 * Static warm/allowlist subset only. Live `heatmap-warm` + Vector recorder use
 * `listSharedUniverseTickers()` (static ∪ dynamic ≤100 / 14d) — do not reintroduce this
 * as the warm batch or Thermal and Vector drift apart again.
 */
export function vectorWarmTickers(): string[] {
  return vectorUniverseTickers();
}

/** True when `ticker` is one of the ~11 warm presets (the fast-move + warm-cron set). */
export function isHeatmapPreset(ticker: string): boolean {
  const root = String(ticker ?? "").trim().toUpperCase();
  return root.length > 0 && (HEATMAP_PRESET_TICKERS as readonly string[]).includes(root);
}
