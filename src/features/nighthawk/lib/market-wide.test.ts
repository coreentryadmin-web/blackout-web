import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { fetchIndexFlowsPooled } from "./market-wide";
import { INDEX_TICKERS } from "./constants";

/**
 * `fetchIndexFlowsPooled` fans the 10 `INDEX_TICKERS` out through UW's per-ticker flow-alerts
 * endpoint (`fetchUwTickerFlowAlertsResult`, unusual-whales.ts). Audit finding (2026-11-09): it
 * used to call the OLDER `fetchUwTickerFlowAlerts(t, 30).catch(() => [])`, which can never
 * actually catch anything — that function inherits `uwGetSafe`'s "never throw" contract, so a
 * genuine UW outage across every tracked ETF produced the identical shape
 * (`{alerts:0, call_premium:0, put_premium:0, total_premium:0}`) as a genuinely flat tape, with
 * nothing anywhere to tell the two apart. Live-confirmed the same day: a real edition pull
 * returned all 10 tracked ETFs simultaneously at exactly that shape, with `index_dossiers: []`
 * (a healthy edition normally carries ~6) — the concrete downstream cost of this collapse.
 *
 * These tests prove the fixed behavior end-to-end through the real `fetchIndexFlowsPooled`
 * (not just the lower-level `fetchUwTickerFlowAlertsResult` unit tests in unusual-whales.test.ts):
 * a real failure across the whole lane now sets `failed: true` on the returned result, while a
 * genuinely quiet tape (UW answers, zero alerts, for every ticker) still reports `failed: false`
 * with the exact same `flows` shape as before.
 */

test("fetchIndexFlowsPooled: failed:true when every tracked index ETF's own UW pull genuinely fails — not silently 'quiet tape'", async () => {
  const prevKey = process.env.UW_API_KEY;
  process.env.UW_API_KEY = "test-uw-key";

  mock.method(globalThis, "fetch", async () => new Response("forbidden", { status: 403 }));

  try {
    const result = await fetchIndexFlowsPooled();
    assert.equal(result.failed, true, "a 403 on every tracked ETF's own flow-alerts pull must be reported as a failure");
    // The failure is real, but the per-ticker rows still shape correctly (zero premium/alerts) —
    // this is exactly the live-observed symptom: index_flows reads identically to a flat tape,
    // and `failed` is the ONLY thing that now tells the two apart.
    for (const t of INDEX_TICKERS) {
      const row = result.flows[t] as { ticker: string; alerts: number; total_premium: number };
      assert.equal(row.ticker, t);
      assert.equal(row.alerts, 0);
      assert.equal(row.total_premium, 0);
    }
  } finally {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.UW_API_KEY; else process.env.UW_API_KEY = prevKey;
  }
});

test("fetchIndexFlowsPooled: failed:false when UW genuinely answers 'zero alerts' for every tracked index ETF", async () => {
  const prevKey = process.env.UW_API_KEY;
  process.env.UW_API_KEY = "test-uw-key";

  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );

  try {
    const result = await fetchIndexFlowsPooled();
    assert.equal(result.failed, false, "a real 200 answer of zero alerts across every tracked ETF is NOT a failure");
    for (const t of INDEX_TICKERS) {
      const row = result.flows[t] as { alerts: number; total_premium: number };
      assert.equal(row.alerts, 0);
      assert.equal(row.total_premium, 0);
    }
  } finally {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.UW_API_KEY; else process.env.UW_API_KEY = prevKey;
  }
});

test("fetchIndexFlowsPooled: a single ticker's failure is still enough to flag the whole lane", async () => {
  const prevKey = process.env.UW_API_KEY;
  process.env.UW_API_KEY = "test-uw-key";

  // Fail only the request for the first ticker in INDEX_TICKERS; every other ticker's own pull
  // genuinely answers "zero alerts". One lane-wide boolean (matching the other 7 discovery-lane
  // fetch-failure flags on MarketWideContext, each one flag per lane, not per sub-call) must still
  // catch a partial outage, not just a total one.
  const failingTicker = INDEX_TICKERS[0];
  mock.method(globalThis, "fetch", async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes(`/api/stock/${failingTicker}/flow-alerts`)) {
      return new Response("forbidden", { status: 403 });
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  try {
    const result = await fetchIndexFlowsPooled();
    assert.equal(result.failed, true, "one failing ticker among ten must still flag the lane");
  } finally {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.UW_API_KEY; else process.env.UW_API_KEY = prevKey;
  }
});
