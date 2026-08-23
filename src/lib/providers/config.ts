export function polygonConfigured(): boolean {
  return Boolean(process.env.POLYGON_API_KEY?.trim());
}

/** Polygon Advanced (Options/Stocks/Indices/Benzinga) — unlimited; prefer over UW for chains, GEX, indices, news. */
export function polygonPrimary(): boolean {
  return polygonConfigured();
}

export function uwConfigured(): boolean {
  return Boolean(process.env.UW_API_KEY?.trim());
}

export function marketDataConfigured(): boolean {
  return polygonConfigured() || uwConfigured();
}

/** Full SPX desk cache (UW + Polygon). Default 20s — SWR serves stale while revalidating. */
export function deskCacheTtlMs(): number {
  const raw = process.env.SPX_DESK_CACHE_SEC?.trim();
  const sec = raw ? Number(raw) : 20;
  if (!Number.isFinite(sec) || sec < 0) return 20_000;
  return Math.round(sec * 1000);
}

/** Hard cap on UW flow-alerts fetch during cold desk build (sticky tape covers gaps). */
export function deskFlowRaceMs(): number {
  const raw = process.env.SPX_DESK_FLOW_RACE_MS?.trim();
  const ms = raw ? Number(raw) : 2500;
  if (!Number.isFinite(ms) || ms < 500) return 2500;
  return Math.round(ms);
}

/** Fast Polygon pulse cache (price, session, internals). Default 1s. */
export function deskPulseCacheTtlMs(): number {
  const raw = process.env.SPX_PULSE_CACHE_SEC?.trim();
  const sec = raw ? Number(raw) : 1;
  if (!Number.isFinite(sec) || sec < 0) return 1_000;
  return Math.round(sec * 1000);
}

/** Hard cap on pulse structure refresh (EMAs, minute bars). Default 3s — stale structure OK on fast lane. */
export function deskPulseStructureRaceMs(): number {
  const raw = process.env.SPX_PULSE_STRUCTURE_RACE_MS?.trim();
  const ms = raw ? Number(raw) : 3_000;
  if (!Number.isFinite(ms) || ms < 500) return 3_000;
  return Math.round(ms);
}

/** Max ms REST pulse may block on a cold miss before serving Redis/last-good fallback. Default 500ms. */
export function deskPulseMaxBlockMs(): number {
  const raw = process.env.SPX_PULSE_MAX_BLOCK_MS?.trim();
  const ms = raw ? Number(raw) : 500;
  if (!Number.isFinite(ms) || ms < 100) return 500;
  return Math.round(ms);
}

/** Max ms bootstrap bundle may block before serving pulse-first partial bundle. Default 3s. */
export function deskBootstrapMaxBlockMs(): number {
  const raw = process.env.SPX_BOOTSTRAP_MAX_BLOCK_MS?.trim();
  const ms = raw ? Number(raw) : 3_000;
  if (!Number.isFinite(ms) || ms < 500) return 3_000;
  return Math.round(ms);
}

/** Max ms 0DTE board cold build may block before serving stale Redis snapshot. Default 3s. */
export function zerodteBoardMaxBlockMs(): number {
  const raw = process.env.ZERODTE_BOARD_MAX_BLOCK_MS?.trim();
  const ms = raw ? Number(raw) : 3_000;
  if (!Number.isFinite(ms) || ms < 500) return 3_000;
  return Math.round(ms);
}

/** Max ms GEX heatmap may block on inflight/cold chain build before serving stale matrix. Default 3s. */
export function gexHeatmapMaxBlockMs(): number {
  const raw = process.env.GEX_HEATMAP_MAX_BLOCK_MS?.trim();
  const ms = raw ? Number(raw) : 3_000;
  if (!Number.isFinite(ms) || ms < 500) return 3_000;
  return Math.round(ms);
}

/** Max ms a `?force=1` matrix recompute may block before failing closed (no stale handoff). Default 55s. */
export function gexHeatmapForceMaxBlockMs(): number {
  const raw = process.env.GEX_HEATMAP_FORCE_MAX_BLOCK_MS?.trim();
  const ms = raw ? Number(raw) : 55_000;
  if (!Number.isFinite(ms) || ms < 5_000) return 55_000;
  return Math.round(ms);
}

/**
 * Max ms SPX UW 0DTE overlay may block finalizeHeatmapForServe.
 * Default 8s — UW spot-exposures REST on a scoped-ladder cache miss routinely takes 3–5s;
 * the old 2s cap returned the UN-OVERLAID Polygon book and false-flagged net-GEX sign vs UW
 * (ops-auto-fix #2503).
 */
export function gexHeatmapOverlayMaxMs(): number {
  const raw = process.env.GEX_HEATMAP_OVERLAY_MAX_MS?.trim();
  const ms = raw ? Number(raw) : 8_000;
  if (!Number.isFinite(ms) || ms < 200) return 8_000;
  return Math.round(ms);
}

/**
 * Max ms `/api/market/vector/flow` may block before returning an HONEST unavailable payload.
 *
 * WHY: the flow read awaits three unbounded upstreams (positioning → front expiry → large prints)
 * with no deadline, so a stall rides all the way to the prod ALB's 120s idle timeout and the member
 * gets a 504 instead of a panel. MEASURED live 2026-08-17 with auth rotation (so these are real
 * server latencies, not token expiry): SPY 3.0s / **504 @ 120.1s** / 6.8s / **85.9s** / 0.5s;
 * NVDA 16.4s / 1.3s / 21.9s / 1.3s / **41.7s**; SPX max 25.4s. Fast and slow calls interleave
 * seconds apart on the SAME ticker, so this is a stall, not load.
 *
 * Default 25s is deliberately generous rather than tight: the same measurement shows genuine,
 * data-carrying responses at 11.6s / 16.4s / 21.9s, and a 10s cap would convert those real reads
 * into empty panels. 25s kills only the pathological tail (41.7s / 85.9s / 120s) while preserving
 * every successful read observed. Tighten via env once the underlying stall is fixed — no deploy.
 */
export function vectorFlowMaxBlockMs(): number {
  const raw = process.env.VECTOR_FLOW_MAX_BLOCK_MS?.trim();
  const ms = raw ? Number(raw) : 25_000;
  if (!Number.isFinite(ms) || ms < 1_000) return 25_000;
  return Math.min(Math.round(ms), 115_000);
}

/** Member POST /api/market/largo/query hard ceiling before ALB idle timeout (120s). Default 100s. */
export function largoMemberRouteDeadlineMs(): number {
  const raw = process.env.LARGO_MEMBER_ROUTE_DEADLINE_MS?.trim();
  const ms = raw ? Number(raw) : 100_000;
  if (!Number.isFinite(ms) || ms < 30_000) return 100_000;
  return Math.min(Math.round(ms), 115_000);
}

/** Anthropic tool-loop budget — route deadline minus prefetch/post overhead. Default 75s. */
export function largoToolLoopBudgetMs(): number {
  const raw = process.env.LARGO_TOOL_LOOP_BUDGET_MS?.trim();
  const ms = raw ? Number(raw) : 75_000;
  if (!Number.isFinite(ms) || ms < 20_000) return 75_000;
  const ceiling = largoMemberRouteDeadlineMs() - 20_000;
  return Math.min(Math.round(ms), Math.max(ceiling, 30_000));
}
/** Member GET /api/market/gex-heatmap hard ceiling before serving any cached snapshot. Default 10s. */
export function gexHeatmapMemberRouteDeadlineMs(): number {
  const raw = process.env.GEX_HEATMAP_MEMBER_ROUTE_DEADLINE_MS?.trim();
  const ms = raw ? Number(raw) : 10_000;
  if (!Number.isFinite(ms) || ms < 2_000) return 10_000;
  return Math.round(ms);
}

/** Max ms member `/api/market/spx/play` may block on cold eval before serving stale/degraded. Default 800ms. */
export function playMemberReadMaxBlockMs(): number {
  const raw = process.env.SPX_PLAY_MEMBER_READ_MAX_BLOCK_MS?.trim();
  const ms = raw ? Number(raw) : 800;
  if (!Number.isFinite(ms) || ms < 200) return 800;
  return Math.round(ms);
}

/** Max ms HELIX /api/market/flows may block on cold PG read before serving last-good snapshot. Default 800ms. */
export function flowsMemberReadMaxBlockMs(): number {
  const raw = process.env.FLOWS_MEMBER_READ_MAX_BLOCK_MS?.trim();
  const ms = raw ? Number(raw) : 800;
  if (!Number.isFinite(ms) || ms < 200) return 800;
  return Math.round(ms);
}

/** Member flows tape cache TTL. Default 60s — flows ingest via WS/cron; longer TTL cuts cross-replica PG hits. */
export function flowsCacheTtlMs(): number {
  const raw = process.env.FLOWS_CACHE_SEC?.trim();
  const sec = raw ? Number(raw) : 60;
  if (!Number.isFinite(sec) || sec < 5) return 60_000;
  return Math.round(sec * 1000);
}

/** Max ms nighthawk edition read may block before serving last-good snapshot. Default 500ms. */
export function nighthawkEditionReadMaxBlockMs(): number {
  const raw = process.env.NIGHTHAWK_EDITION_READ_MAX_BLOCK_MS?.trim();
  const ms = raw ? Number(raw) : 500;
  if (!Number.isFinite(ms) || ms < 100) return 500;
  return Math.round(ms);
}

/** Nighthawk edition response cache. Default 60s — edition changes once per session after close. */
export function nighthawkEditionCacheTtlMs(): number {
  const raw = process.env.NIGHTHAWK_EDITION_CACHE_SEC?.trim();
  const sec = raw ? Number(raw) : 60;
  if (!Number.isFinite(sec) || sec < 5) return 60_000;
  return Math.round(sec * 1000);
}

/** Max ms gex-heatmap overlay/cross-validation enrichment may block after matrix read. Default 800ms. */
export function gexHeatmapEnrichmentMaxMs(): number {
  const raw = process.env.GEX_HEATMAP_ENRICHMENT_MAX_MS?.trim();
  const ms = raw ? Number(raw) : 800;
  if (!Number.isFinite(ms) || ms < 200) return 800;
  return Math.round(ms);
}

/** Slower pulse structure refresh (EMAs, minute bars, mega-caps). Default 5s with live Polygon. */
export function deskPulseStructureCacheTtlMs(): number {
  const raw = process.env.SPX_PULSE_STRUCTURE_SEC?.trim();
  const sec = raw ? Number(raw) : 5;
  if (!Number.isFinite(sec) || sec < 0) return 10_000;
  return Math.round(sec * 1000);
}

/** UW flow lane cache (tape + GEX strikes). Default 2s. */
export function deskFlowCacheTtlMs(): number {
  const raw = process.env.SPX_FLOW_CACHE_SEC?.trim();
  const sec = raw ? Number(raw) : 2;
  if (!Number.isFinite(sec) || sec < 0) return 2_000;
  return Math.round(sec * 1000);
}

/** Optional merge from engine /spx/state. Off by default — website owns live desk data. */
/**
 * SPY-minute-volume proxy for the SPX session VWAP. **Default ON.**
 *
 * SPX index minute bars carry no volume (ISSUE-16), so without a proxy the desk "VWAP" is an
 * equal-weight typical-price mean and `vwap_volume_weighted` is false. SPY 1m share volume is the
 * standard index proxy and is already what the Vector chart weights with.
 *
 * This used to be gated on `isStagingDeploy()`. Staging was decommissioned 2026-07-25, so that
 * gate has been permanently false in every environment that exists — which left PB-01 (VWAP
 * Reclaim) and PB-02 (VWAP Reject) unable to satisfy their `volumeWeightedVwap` data requirement,
 * and therefore unable to fire at all while `PLAYBOOK_LIVE_GATE=1` in production. See
 * `docs/spx/SLAYER-MAP.md` §7.1.
 *
 * Default ON so the capability ships without a secret change; set `SPX_VWAP_SPY_PROXY=0` to revert
 * to the typical-price fallback instantly, without a deploy, if it ever misbehaves.
 */
export function spxVwapSpyProxyEnabled(): boolean {
  const raw = process.env.SPX_VWAP_SPY_PROXY?.trim().toLowerCase();
  if (!raw) return true;
  return raw === "1" || raw === "true";
}

export function engineIntelOverlayEnabled(): boolean {
  return process.env.ENGINE_INTEL_OVERLAY?.trim().toLowerCase() === "1";
}
