/*
 * Pure schema + sanity validators for the 0DTE E2E suite (zerodte-e2e-suite.mjs).
 *
 * NO network, NO secrets, NO side effects — every function takes an already-parsed
 * upstream payload (+ optional context) and returns a plain verdict object:
 *
 *     { pass: boolean, sanity: "GREEN" | "AMBER", detail: string }
 *
 *   - `pass=false`  → the response is structurally wrong (missing the array/fields the
 *                     pipeline reads). For a REQUIRED endpoint the runner turns this into RED.
 *   - `sanity`      → structure is fine but a value is off/empty in a way that is EXPECTED
 *                     off-hours (e.g. empty greeks, empty trade tape). AMBER, never RED.
 *
 * Every threshold here is grounded in docs/audit/NIGHTHAWK-DATA-PROVENANCE.md + the live
 * captures taken while building this tool (grouped-daily ~12.4k rows, VIX ~18.6, SPX ~7.4k,
 * UW `{data:[...]}` envelope). Kept pure so zerodte-e2e-suite.test.ts can drive every branch
 * with mock payloads and NO live calls.
 */

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const toNum = (x) => {
  if (x == null) return null;
  const n = typeof x === "string" ? Number(x) : x;
  return isNum(n) ? n : null;
};
const ok = (detail, sanity = "GREEN") => ({ pass: true, sanity, detail });
const bad = (detail) => ({ pass: false, sanity: "AMBER", detail });

/**
 * Normalize the three upstream list envelopes into a plain array (mirrors the app's own
 * `extractRows`): a bare array, Polygon's `{results:[...]}`, UW's `{data:[...]}`, or the
 * option-chain `{chains:[...]}`. Returns null when none is present (structurally wrong).
 */
export function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.chains)) return payload.chains;
  return null;
}

// ── Polygon / Massive ────────────────────────────────────────────────────────────────

/** GET /v1/marketstatus/now — RTH gating (polygon.ts:1411). Needs a `market` string + an
 *  `exchanges` object so the scan's RTH gate can read a real session state. */
export function checkMarketStatus(p) {
  if (!p || typeof p.market !== "string") return bad("no `market` string on payload");
  if (!p.exchanges || typeof p.exchanges !== "object") return bad("no `exchanges` object");
  const known = ["open", "closed", "extended-hours"];
  if (!known.includes(p.market)) return { pass: true, sanity: "AMBER", detail: `market="${p.market}" (unexpected value)` };
  return ok(`market=${p.market} nyse=${p.exchanges.nyse ?? "?"}`);
}

/** GET /v3/snapshot/indices — VIX (G-4) + SPX regime (polygon.ts:390). VIX must be a
 *  plausible 5–90; SPX a plausible 1000–20000. A garbage/absent VIX would either block
 *  every commit (fail-closed) or, worse, mis-set the regime. */
export function checkIndices(p, { want = ["I:SPX", "I:VIX"] } = {}) {
  const rows = asArray(p);
  if (!rows) return bad("no results[] array");
  const byT = new Map(rows.map((r) => [r?.ticker, toNum(r?.value)]));
  const parts = [];
  for (const t of want) {
    const v = byT.get(t);
    if (v == null) return bad(`${t} missing/non-numeric value`);
    if (t === "I:VIX" && (v < 5 || v > 90)) return bad(`VIX=${v} implausible (want 5–90)`);
    if (t === "I:SPX" && (v < 1000 || v > 20000)) return bad(`SPX=${v} implausible (want 1000–20000)`);
    parts.push(`${t}=${v}`);
  }
  return ok(parts.join(" "));
}

/** GET /v2/aggs/ticker/{sym}/prev — prior-session OHLC (spx-session / bias seed). */
export function checkAggsPrev(p) {
  const rows = asArray(p);
  if (!rows || rows.length === 0) return bad("no results[] bar");
  const b = rows[0];
  const c = toNum(b?.c), h = toNum(b?.h), l = toNum(b?.l);
  if (c == null || c <= 0) return bad("close missing/non-positive");
  if (h != null && l != null && h < l) return bad(`high ${h} < low ${l}`);
  return ok(`prevClose=${c}`);
}

/** GET /v2/aggs/ticker/{sym}/range/1/minute/… — minute bars (bias, VIX day, grading). */
export function checkAggsRange(p, { minBars = 1 } = {}) {
  const rows = asArray(p);
  if (!rows) return bad("no results[] array");
  if (rows.length < minBars) return bad(`only ${rows.length} bars (< ${minBars})`);
  const b = rows[0];
  for (const k of ["o", "c", "h", "l"]) if (toNum(b?.[k]) == null) return bad(`bar missing ${k}`);
  return ok(`${rows.length} bars, o=${b.o} c=${b.c}`);
}

/** GET /v2/aggs/grouped/locale/us/market/stocks/{date} — whole-market OHLCV (~12.4k rows),
 *  the input the breakout/banger discovery screens. A truncated grouped feed = a starved
 *  discovery pool (polygon.ts:233). */
export function checkGroupedDaily(p, { minStocks = 8000 } = {}) {
  const rows = asArray(p);
  if (!rows) return bad("no results[] array");
  const n = toNum(p?.resultsCount) ?? rows.length;
  if (n < minStocks) return bad(`${n} stocks (< ${minStocks} — feed truncated?)`);
  const r = rows[0];
  if (r && (toNum(r.c) == null || !r.T)) return bad("first row missing ticker/close");
  return ok(`${n} stocks`);
}

/** GET /v3/snapshot/options/{underlying} — per-contract chain + greeks (GEX walls, contract
 *  pick). Structural spine: details{ticker,strike_price} + last_quote{bid,ask}. Greeks are
 *  `{}` OFF-HOURS (they need a live vol surface) → AMBER, not RED, unless the market is open. */
export function checkOptionChainSnapshot(p, { rth = false } = {}) {
  const rows = asArray(p);
  if (!rows || rows.length === 0) return bad("no results[] contracts");
  const c = rows[0];
  // The OCC ticker sits under details.ticker on /v3/snapshot/options/{underlying} but at TOP LEVEL
  // (`ticker`) on the unified /v3/snapshot — accept either so both endpoints share this check.
  const occTicker = c?.details?.ticker || c?.ticker;
  if (!occTicker || toNum(c?.details?.strike_price) == null) return bad("contract missing ticker/details.strike_price");
  const lq = c.last_quote;
  if (!lq || toNum(lq.bid) == null || toNum(lq.ask) == null) return bad("contract missing last_quote{bid,ask}");
  const greeksPopulated = c.greeks && Object.keys(c.greeks).length > 0 && toNum(c.greeks.delta) != null;
  if (rth && !greeksPopulated) return { pass: true, sanity: "AMBER", detail: `${rows.length} contracts, but greeks EMPTY during RTH (watch: GEX/plan pin off a phantom greek)` };
  return ok(`${rows.length} contracts, greeks ${greeksPopulated ? "populated" : "empty (off-hours OK)"}`, greeksPopulated ? "GREEN" : "AMBER");
}

/** GET /v3/snapshot?ticker.any_of=<OCC csv> — unified per-OCC snapshot (contract plan + live
 *  mark REST fallback; options-snapshot.ts:301). Same shape as the chain snapshot. */
export function checkUnifiedSnapshot(p, { rth = false } = {}) {
  const rows = asArray(p);
  if (!rows || rows.length === 0) return bad("no results[] for requested OCC(s)");
  return checkOptionChainSnapshot(p, { rth });
}

/** GET /v3/reference/options/contracts — expiry/OI discovery (polygon-options-gex.ts:3220). */
export function checkReferenceContracts(p) {
  const rows = asArray(p);
  if (!rows || rows.length === 0) return bad("no results[] contracts");
  const c = rows[0];
  if (!c?.ticker || !c?.expiration_date || toNum(c?.strike_price) == null) return bad("contract missing ticker/expiration_date/strike_price");
  return ok(`${rows.length} contracts, first exp=${c.expiration_date}`);
}

/** GET /v3/trades/{occ} — option tape (flow-verifier, gex-intraday-adjust; option-trades.ts).
 *  Trade tape is legitimately EMPTY off-hours → array-present passes, empty is AMBER. */
export function checkV3Trades(p) {
  const rows = asArray(p);
  if (!rows) return bad("no results[] array");
  if (rows.length === 0) return { pass: true, sanity: "AMBER", detail: "0 trades (empty off-hours — OK)" };
  const t = rows[0];
  if (toNum(t?.price) == null || toNum(t?.sip_timestamp) == null) return bad("trade missing price/sip_timestamp");
  return ok(`${rows.length} trades, last=${t.price}`);
}

/** GET /benzinga/v2/news — catalysts/news (dossier synthesis; polygon-news.ts). */
export function checkBenzingaNews(p) {
  const rows = asArray(p);
  if (!rows) return bad("no results[] array");
  if (rows.length === 0) return { pass: true, sanity: "AMBER", detail: "0 news items (OK — degrades gracefully)" };
  if (!rows[0]?.title) return bad("news item missing title");
  return ok(`${rows.length} news items`);
}

// ── Unusual Whales ───────────────────────────────────────────────────────────────────

/** GET /api/option-trades/flow-alerts — the PRIMARY discovery input (via Postgres). The
 *  socket keeps `flow_alerts` warm; the REST feed proves the upstream is serving flow. */
export function checkFlowAlerts(p, { minRows = 1 } = {}) {
  const rows = asArray(p);
  if (!rows) return bad("no data[] array");
  if (rows.length < minRows) return { pass: true, sanity: "AMBER", detail: `${rows.length} flow rows (thin/off-hours)` };
  const r = rows[0];
  if (toNum(r?.total_premium) == null && toNum(r?.strike) == null) return bad("flow row missing total_premium/strike");
  return ok(`${rows.length} flow alerts`);
}

/** GET /api/stock/{t}/flow-alerts — per-ticker flow (market-wide index tickers). */
export function checkTickerFlowAlerts(p) {
  const rows = asArray(p);
  if (!rows) return bad("no data[] array");
  return ok(`${rows.length} ticker flow rows`, rows.length ? "GREEN" : "AMBER");
}

/** GET /api/stock/{t}/spot-exposures/strike — per-strike GEX ladder (Night Hawk GEX walls;
 *  the 0DTE-correct feed). Each row must carry strike + a gamma-OI field. */
export function checkSpotExposuresStrike(p, { minRows = 1 } = {}) {
  const rows = asArray(p);
  if (!rows) return bad("no data[] array");
  if (rows.length < minRows) return bad(`${rows.length} GEX strike rows (< ${minRows})`);
  const r = rows[0];
  if (toNum(r?.strike) == null) return bad("GEX row missing strike");
  const hasGamma = ["call_gamma_oi", "put_gamma_oi", "call_gex", "put_gex", "gamma"].some((k) => toNum(r?.[k]) != null);
  if (!hasGamma) return bad("GEX row has no gamma/gex field");
  return ok(`${rows.length} GEX strike rows`);
}

/** GET /api/stock/{t}/greek-exposure/strike — cumulative GEX (spot-exposures fallback). */
export function checkGreekExposureStrike(p, { minRows = 1 } = {}) {
  const rows = asArray(p);
  if (!rows) return bad("no data[] array");
  if (rows.length < minRows) return bad(`${rows.length} greek-exposure rows`);
  const r = rows[0];
  if (toNum(r?.strike) == null || (toNum(r?.call_gex) == null && toNum(r?.put_gex) == null)) return bad("row missing strike/call_gex/put_gex");
  return ok(`${rows.length} greek-exposure strike rows`);
}

/** GET /api/screener/stocks — screener confirm (dossier). */
export function checkScreenerStocks(p, { minRows = 1 } = {}) {
  const rows = asArray(p);
  if (!rows) return bad("no data[] array");
  if (rows.length < minRows) return { pass: true, sanity: "AMBER", detail: `${rows.length} screener rows (thin)` };
  if (!rows[0]?.ticker) return bad("screener row missing ticker");
  return ok(`${rows.length} screener rows`);
}

/** GET /api/darkpool/{ticker} — dark-pool prints (dossier). */
export function checkDarkpool(p) {
  const rows = asArray(p);
  if (!rows) return bad("no data[] array");
  if (rows.length === 0) return { pass: true, sanity: "AMBER", detail: "0 dark-pool prints (off-hours OK)" };
  if (toNum(rows[0]?.price) == null && toNum(rows[0]?.size) == null) return bad("dark-pool row missing price/size");
  return ok(`${rows.length} dark-pool prints`);
}

/** GET /api/net-flow/expiry — per-expiry net flow (net-prem velocity). */
export function checkNetFlowExpiry(p) {
  const rows = asArray(p);
  if (!rows) return bad("no data[] array");
  return ok(`${rows.length} net-flow expiry groups`, rows.length ? "GREEN" : "AMBER");
}

/** GET /api/earnings/{premarket|afterhours} — earnings names feeding G-11. Legitimately
 *  EMPTY on a day with no reporters → array-present passes; emptiness is data, not an error.
 *  (Note: the per-ticker `/api/stock/{t}/earnings-dates` route is NOT real — it 404s; the
 *  real routes are premarket/afterhours + /api/earnings/{ticker}.) */
export function checkEarnings(p) {
  const rows = asArray(p);
  if (!rows) return bad("no data[] array");
  if (rows.length === 0) return { pass: true, sanity: "AMBER", detail: "0 earnings names (no reporters — OK)" };
  if (!rows[0]?.symbol && !rows[0]?.ticker) return bad("earnings row missing symbol/ticker");
  return ok(`${rows.length} earnings names`);
}

// ── infra sanity (pure) ────────────────────────────────────────────────────────────────

/** Pure verdict for an AWS RDS DBInstance describe blob → available + Multi-AZ note. */
export function checkRdsInstance(inst, { wantId } = {}) {
  if (!inst || typeof inst !== "object") return bad("no DBInstance");
  if (wantId && inst.DBInstanceIdentifier !== wantId) return bad(`id=${inst.DBInstanceIdentifier} != ${wantId}`);
  const status = inst.DBInstanceStatus;
  if (status !== "available") return bad(`status=${status} (want available)`);
  const az = inst.MultiAZ ? "Multi-AZ" : "single-AZ";
  const eng = `${inst.Engine ?? "?"} ${inst.EngineVersion ?? ""}`.trim();
  return ok(`available · ${az} · ${eng}`, inst.MultiAZ ? "GREEN" : "AMBER");
}

/** Pure verdict for an ElastiCache replication-group describe blob → available + failover. */
export function checkRedisReplicationGroup(rg, { wantId } = {}) {
  if (!rg || typeof rg !== "object") return bad("no ReplicationGroup");
  if (wantId && rg.ReplicationGroupId !== wantId) return bad(`id=${rg.ReplicationGroupId} != ${wantId}`);
  if (rg.Status !== "available") return bad(`status=${rg.Status} (want available)`);
  const failover = rg.AutomaticFailover === "enabled";
  const multiAz = rg.MultiAZ === "enabled";
  const nodes = Array.isArray(rg.MemberClusters) ? rg.MemberClusters.length : (rg.NodeGroups?.[0]?.NodeGroupMembers?.length ?? "?");
  return ok(`available · ${nodes}-node · failover ${failover ? "on" : "OFF"} · ${multiAz ? "Multi-AZ" : "single-AZ"}`, failover ? "GREEN" : "AMBER");
}

/** Pure verdict for the board-snapshot age (Redis path) — GREEN if the snapshot exists and
 *  (when RTH) is fresher than the bound; off-hours a stale snapshot is expected → AMBER. */
export function checkSnapshotFreshness(asOfMs, nowMs, { rth = false, boundMs = 6 * 60 * 1000 } = {}) {
  if (asOfMs == null || !isNum(asOfMs)) return bad("no snapshot as_of timestamp (Redis board snapshot not served)");
  const ageMs = nowMs - asOfMs;
  // A few seconds of "future" as_of is benign server/client clock skew — the snapshot IS being
  // served (the thing we're proving). Only flag a large forward skew.
  const SKEW_TOL_MS = 5_000;
  if (ageMs < -SKEW_TOL_MS) return { pass: true, sanity: "AMBER", detail: `as_of in the future by ${Math.abs(ageMs)}ms (clock skew?)` };
  if (ageMs < 0) return ok(`snapshot fresh (${Math.abs(ageMs)}ms skew)`);
  const ageStr = `${Math.round(ageMs / 1000)}s old`;
  if (rth && ageMs > boundMs) return { pass: true, sanity: "AMBER", detail: `snapshot ${ageStr} > ${Math.round(boundMs / 1000)}s bound during RTH (cron lagging?)` };
  return ok(`snapshot ${ageStr}`);
}
