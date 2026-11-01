import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTelemetry } from "@/lib/admin-api-dashboard-match";
import type { ApiEndpointStats } from "@/lib/api-telemetry-types";
import type { CatalogEndpoint } from "@/lib/api-provider-catalog";

function stat(overrides: Partial<ApiEndpointStats>): ApiEndpointStats {
  return {
    endpoint: "/health",
    method: "GET",
    call_count: 1,
    error_count: 0,
    last_status: 200,
    last_latency_ms: 10,
    last_ok: true,
    last_at: "2026-10-30T00:00:00.000Z",
    last_error: null,
    avg_latency_ms: 10,
    latency_samples: [10],
    p95_latency_ms: 10,
    p99_latency_ms: 10,
    ...overrides,
  };
}

// Mirrors the real blackout_engine "/{proxy}" catalog row (api-provider-catalog.ts) —
// a catch-all whose ENTIRE path is one dynamic segment, with no literal prefix.
const PROXY_CATCH_ALL: CatalogEndpoint = {
  endpoint: "/{proxy}",
  method: "GET",
  description: "Catch-all engine proxy routes",
  used_by: ["/api/engine/*"],
};

test("admin-api-dashboard matchTelemetry: a fully-wildcard catalog row (/{proxy}) must not steal another endpoint's telemetry", () => {
  // /health is a DIFFERENT, more specific catalog row (its own exact entry) — the
  // catch-all proxy row has no business claiming its stat just because every path
  // starts with "/".
  const healthStat = stat({ endpoint: "/health", method: "GET", last_at: "2026-10-30T12:00:00.000Z" });

  const matched = matchTelemetry(PROXY_CATCH_ALL, "blackout_engine", [healthStat]);

  // Root cause (pre-fix): normalizeEndpointKey("/{proxy}") -> "/{*}", and stripping the
  // sole "{*}" token collapses the normalized key to a bare "/" — a prefix (and substring)
  // of every real endpoint, so `normStat.startsWith("/")` and the final `s.endpoint.startsWith(prefix)`
  // fallback both trivially pass for ANY stat, including /health's. That silently misattributes
  // the health probe's own telemetry (status/latency/last_at) to the unrelated "Catch-all engine
  // proxy routes" dashboard row.
  assert.equal(
    matched,
    null,
    "a wildcard-only catalog endpoint must never fuzzy/prefix-match another endpoint's real stat"
  );
});

test("admin-api-dashboard matchTelemetry: parameterized endpoints with a real literal prefix still match normally (no regression)", () => {
  const catalogEp: CatalogEndpoint = {
    endpoint: "/api/stock/{ticker}/spot-exposures/strike",
    method: "GET",
    description: "Spot GEX by strike",
    used_by: ["desk GEX"],
  };
  const realCall = stat({
    endpoint: "/api/stock/AAPL/spot-exposures/strike",
    method: "GET",
    last_at: "2026-10-30T12:00:00.000Z",
  });
  const unrelated = stat({ endpoint: "/api/market/market-tide", method: "GET", last_at: "2026-10-30T11:00:00.000Z" });

  const matched = matchTelemetry(catalogEp, "unusual_whales", [unrelated, realCall]);
  assert.equal(matched, realCall);
});

test("admin-api-dashboard matchTelemetry: multi-param endpoints still fall back to the literal prefix match (no regression)", () => {
  const catalogEp: CatalogEndpoint = {
    endpoint: "/v2/aggs/ticker/{symbol}/range/1/minute/{from}/{to}",
    method: "GET",
    description: "Intraday 1-minute bars",
    used_by: ["SPX structure"],
  };
  const realCall = stat({
    endpoint: "/v2/aggs/ticker/AAPL/range/1/minute/1696100000000/1696200000000",
    method: "GET",
    last_at: "2026-10-30T12:00:00.000Z",
  });

  const matched = matchTelemetry(catalogEp, "polygon", [realCall]);
  assert.equal(matched, realCall);
});

test("admin-api-dashboard matchTelemetry: sibling catalog rows sharing one prefix must not steal each other's telemetry", () => {
  // Real catalog rows (api-provider-catalog.ts): "/api/stock/{ticker}/max-pain" and
  // "/api/stock/{ticker}/nope" — and ~9 other UW per-ticker endpoints — all share the
  // identical literal text up to their FIRST placeholder ("/api/stock/"). The literal text
  // AFTER the placeholder ("max-pain" vs "nope") is what actually distinguishes them, and
  // the pre-fix fuzzy check never compared it (see endpointSegmentsMatch's doc comment).
  const maxPainCatalog: CatalogEndpoint = {
    endpoint: "/api/stock/{ticker}/max-pain",
    method: "GET",
    description: "Max pain",
    used_by: ["desk pulse"],
  };
  const nopeCatalog: CatalogEndpoint = {
    endpoint: "/api/stock/{ticker}/nope",
    method: "GET",
    description: "NOPE",
    used_by: ["desk pulse"],
  };
  const maxPainStat = stat({
    endpoint: "/api/stock/NVDA/max-pain",
    method: "GET",
    last_at: "2026-10-30T12:00:00.000Z",
    last_status: 200,
  });
  const nopeStat = stat({
    endpoint: "/api/stock/TSLA/nope",
    method: "GET",
    last_at: "2026-10-30T11:00:00.000Z",
    last_status: 503,
    last_ok: false,
  });

  // Order matters for the bug: the final fallback is `stats.find(...)`, which returns the
  // FIRST prefix match — so max-pain's own stat sitting before nope's in the array is what
  // exposed the mislabel (nope's dashboard row rendering max-pain's 200/healthy status).
  const stats = [maxPainStat, nopeStat];

  const matchedMaxPain = matchTelemetry(maxPainCatalog, "unusual_whales", stats);
  const matchedNope = matchTelemetry(nopeCatalog, "unusual_whales", stats);

  assert.equal(matchedMaxPain, maxPainStat, "max-pain row must show its own stat");
  assert.equal(matchedNope, nopeStat, "nope row must show its own stat, not max-pain's");
});

test("admin-api-dashboard matchTelemetry: sibling aggs-bars rows (minute vs day) must not steal each other's telemetry", () => {
  // Real catalog rows: "/v2/aggs/ticker/{symbol}/range/1/minute/{from}/{to}" and
  // "/v2/aggs/ticker/{symbol}/range/1/day/{from}/{to}" share the same literal prefix up to
  // their first placeholder ("{symbol}") — "minute" vs "day" only differs AFTER it.
  const minuteCatalog: CatalogEndpoint = {
    endpoint: "/v2/aggs/ticker/{symbol}/range/1/minute/{from}/{to}",
    method: "GET",
    description: "Intraday 1-minute bars",
    used_by: ["SPX structure"],
  };
  const dayCatalog: CatalogEndpoint = {
    endpoint: "/v2/aggs/ticker/{symbol}/range/1/day/{from}/{to}",
    method: "GET",
    description: "Daily bars",
    used_by: ["SPX structure"],
  };
  const minuteStat = stat({
    endpoint: "/v2/aggs/ticker/SPY/range/1/minute/1696100000000/1696103600000",
    method: "GET",
    last_at: "2026-10-30T12:00:00.000Z",
  });
  const dayStat = stat({
    endpoint: "/v2/aggs/ticker/SPY/range/1/day/1696000000000/1696900000000",
    method: "GET",
    last_at: "2026-10-30T11:00:00.000Z",
  });
  const stats = [minuteStat, dayStat];

  assert.equal(matchTelemetry(minuteCatalog, "polygon", stats), minuteStat);
  assert.equal(matchTelemetry(dayCatalog, "polygon", stats), dayStat);
});

test("admin-api-dashboard matchTelemetry: never cross-matches a different HTTP method on the same literal path", () => {
  const catalogEp: CatalogEndpoint = {
    endpoint: "/v1/marketstatus/now",
    method: "GET",
    description: "Market open / extended / closed",
    used_by: ["session guards"],
  };
  // Same literal path, wrong method — must never be picked for a GET catalog row.
  const wrongMethod = stat({ endpoint: "/v1/marketstatus/now", method: "POST", last_at: "2026-10-30T12:00:00.000Z" });

  const matched = matchTelemetry(catalogEp, "polygon", [wrongMethod]);
  assert.equal(matched, null);
});
