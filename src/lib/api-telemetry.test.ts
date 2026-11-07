import { test } from "node:test";
import assert from "node:assert/strict";
import { endpointTemplate, recordApiCall, getApiTelemetrySnapshot } from "./api-telemetry";

// Phase 1 instrumentation (queue-wait vs. HTTP-execution split, cancel reason) —
// purely additive fields on ApiCallEvent. These tests lock in that omitting them
// (every pre-existing caller) behaves exactly as before, and that a caller which
// does supply them gets them recorded faithfully.

test("recordApiCall: queue_wait_ms/cancel_reason default to null when the caller omits them (pre-instrumentation behavior, unchanged)", () => {
  const event = recordApiCall({
    provider: "unusual_whales",
    endpoint: "/api/darkpool/AAPL",
    method: "GET",
    status: 200,
    ok: true,
    latency_ms: 250,
  });
  assert.equal(event.queue_wait_ms, null);
  assert.equal(event.cancel_reason, null);
});

test("recordApiCall: queue_wait_ms/cancel_reason are recorded verbatim when a caller supplies them", () => {
  const event = recordApiCall({
    provider: "unusual_whales",
    endpoint: "/api/darkpool/AAPL",
    method: "GET",
    status: null,
    ok: false,
    latency_ms: 15000,
    error: "aborted",
    queue_wait_ms: 18234,
    cancel_reason: "dossier_ticker_wall_timeout",
  });
  assert.equal(event.queue_wait_ms, 18234);
  assert.equal(event.cancel_reason, "dossier_ticker_wall_timeout");
  // Existing fields this instrumentation must not perturb:
  assert.equal(event.latency_ms, 15000, "latency_ms stays HTTP-only, unaffected by queue_wait_ms");
});

// Locks the audit §3.1 fix: the endpointStats Map was UNBOUNDED because Polygon paths embed the
// ticker / OCC / date in the key, so every distinct symbol leaked a permanent entry. The fix
// templates the key (per-symbol → one bounded key) with an LRU cap backstop.

test("endpointTemplate: collapses OCC / ticker / index / date and strips the query", () => {
  // OCC option symbols (prefixed)
  assert.equal(
    endpointTemplate("/v3/snapshot/options/O:SPXW250101C05850000"),
    "/v3/snapshot/options/:occ"
  );
  // bare OCC (no O: prefix)
  assert.equal(endpointTemplate("/options/SPXW250101C05850000/quote"), "/options/:occ/quote");
  // ticker + ISO dates in an aggregates path
  assert.equal(
    endpointTemplate("/v2/aggs/ticker/AAPL/range/1/day/2024-01-01/2024-12-31"),
    "/v2/aggs/ticker/:sym/range/1/day/:date/:date"
  );
  // indicator paths collapse the per-symbol segment (bare stock AND I:idx → :sym, one bounded key)
  assert.equal(endpointTemplate("/v1/indicators/ema/AAPL"), "/v1/indicators/ema/:sym");
  assert.equal(endpointTemplate("/v1/indicators/macd/I:SPX"), "/v1/indicators/macd/:sym");
  // index symbol in a NON-indicator path still collapses via the I: rule
  assert.equal(endpointTemplate("/v3/snapshot/indices/I:VIX"), "/v3/snapshot/indices/:idx");
  // PLURAL /tickers/{sym} — the leak the review caught (the singular /ticker/ rule missed it)
  assert.equal(endpointTemplate("/v3/reference/tickers/AAPL"), "/v3/reference/tickers/:sym");
  assert.equal(
    endpointTemplate("/v3/reference/tickers/AAPL/related"),
    "/v3/reference/tickers/:sym/related"
  );
  assert.equal(
    endpointTemplate("/v2/snapshot/locale/us/markets/stocks/tickers/NVDA"),
    "/v2/snapshot/locale/us/markets/stocks/tickers/:sym"
  );
  // the query string (the unified-snapshot ticker.any_of CSV is the worst leak source) is dropped
  assert.equal(
    endpointTemplate("/v3/snapshot?ticker.any_of=O:SPXW250101C05850000,O:SPXW250101P05850000&limit=250"),
    "/v3/snapshot"
  );
  // a non-symbol path is unchanged
  assert.equal(endpointTemplate("/v3/reference/tickers"), "/v3/reference/tickers");
});

// Regression: endpointTemplate()'s own doc comment claims it collapses "per-ticker / per-OCC
// paths" into one bounded endpointStats entry "instead of leaking a permanent entry per symbol
// (audit 03-BACKEND §3.1)" — but every Unusual Whales per-ticker path is shaped
// `/api/<category>/<TICKER>/<rest>` (e.g. `/api/stock/NVDA/flow-alerts`, `/api/darkpool/AAPL`,
// `/api/shorts/TSLA/ftds` — see src/lib/providers/unusual-whales.ts's uwGetSafe call sites),
// which none of the existing regexes touch: they only cover Polygon's `/ticker/`, `/tickers/`,
// `/indicators/.../`, bare/prefixed OCC and `I:` index shapes. So the UW provider — the biggest
// per-symbol-fan-out caller in the codebase (every desk polls flow-alerts/greeks/darkpool/etc.
// per watched ticker) — gets ZERO templating: a distinct, permanent endpointStats row per ticker
// per UW endpoint, the exact unbounded-cardinality leak this function exists to prevent.
test("endpointTemplate: collapses Unusual Whales per-ticker paths (the UW cardinality gap)", () => {
  assert.equal(endpointTemplate("/api/stock/NVDA/flow-alerts"), "/api/stock/:sym/flow-alerts");
  assert.equal(endpointTemplate("/api/stock/AAPL/flow-alerts"), "/api/stock/:sym/flow-alerts");
  assert.equal(endpointTemplate("/api/stock/TSLA/max-pain"), "/api/stock/:sym/max-pain");
  assert.equal(endpointTemplate("/api/darkpool/AAPL"), "/api/darkpool/:sym");
  assert.equal(endpointTemplate("/api/shorts/TSLA/ftds"), "/api/shorts/:sym/ftds");
  assert.equal(endpointTemplate("/api/etfs/SPY/in-outflow"), "/api/etfs/:sym/in-outflow");
  assert.equal(endpointTemplate("/api/lit-flow/NVDA"), "/api/lit-flow/:sym");
  assert.equal(
    endpointTemplate("/api/seasonality/AAPL/monthly"),
    "/api/seasonality/:sym/monthly"
  );
  assert.equal(
    endpointTemplate("/api/companies/NVDA/earnings-estimates"),
    "/api/companies/:sym/earnings-estimates"
  );
  assert.equal(
    endpointTemplate("/api/stock/NVDA/spot-exposures/expiry-strike"),
    "/api/stock/:sym/spot-exposures/expiry-strike"
  );
  assert.equal(
    endpointTemplate("/api/market/technology/sector-tide"),
    "/api/market/:sym/sector-tide"
  );
  assert.equal(endpointTemplate("/api/market/SPY/etf-tide"), "/api/market/:sym/etf-tide");
  // Market-wide (no ticker segment) paths must NOT be touched by the new rule.
  assert.equal(endpointTemplate("/api/market/market-tide"), "/api/market/market-tide");
  assert.equal(endpointTemplate("/api/market/top-net-impact"), "/api/market/top-net-impact");
  assert.equal(endpointTemplate("/api/market/fda-calendar"), "/api/market/fda-calendar");
});

test("endpointStats stays bounded for Unusual Whales — 600 distinct-ticker UW paths collapse to ONE templated key", () => {
  for (let i = 0; i < 600; i++) {
    recordApiCall({
      provider: "unusual_whales",
      endpoint: `/api/stock/SYM${i}/flow-alerts`,
      method: "GET",
      status: 200,
      ok: true,
      latency_ms: 10,
    });
  }
  const uwEndpoints = getApiTelemetrySnapshot(10 * 60_000).by_provider.unusual_whales.endpoints;
  const templated = uwEndpoints.find((e) => e.endpoint === "/api/stock/:sym/flow-alerts");
  assert.ok(templated, "expected the one templated UW flow-alerts key");
  assert.equal(templated!.call_count, 600, "all 600 calls aggregate into the one templated key");
  assert.ok(
    uwEndpoints.length < 10,
    `unusual_whales endpoint cardinality should stay small, got ${uwEndpoints.length}`
  );
});

test("endpointStats stays bounded — 600 distinct-ticker paths collapse to ONE templated key", () => {
  // Pre-fix, this loop would leave 600 permanent endpointStats rows (the leak).
  for (let i = 0; i < 600; i++) {
    recordApiCall({
      provider: "polygon",
      endpoint: `/v2/aggs/ticker/SYM${i}/range/1/day/2024-01-01/2024-12-31`,
      method: "GET",
      status: 200,
      ok: true,
      latency_ms: 10,
    });
  }
  const polyEndpoints = getApiTelemetrySnapshot(10 * 60_000).by_provider.polygon.endpoints;
  const templated = polyEndpoints.find(
    (e) => e.endpoint === "/v2/aggs/ticker/:sym/range/1/day/:date/:date"
  );
  assert.ok(templated, "expected the one templated aggs key");
  assert.equal(templated!.call_count, 600, "all 600 calls aggregate into the one templated key");
  assert.ok(
    polyEndpoints.length < 10,
    `polygon endpoint cardinality should stay small, got ${polyEndpoints.length}`
  );
});
