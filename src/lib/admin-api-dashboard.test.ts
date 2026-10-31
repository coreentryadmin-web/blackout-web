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
