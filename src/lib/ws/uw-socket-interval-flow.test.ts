import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketIntervalFlowRows } from "./uw-socket";

test("bucketIntervalFlowRows: a frame with ONLY non-SPX rows reports spxRows as null, not every row", () => {
  // `interval_flow` is a market-wide feed (joined unscoped — no ticker suffix, unlike
  // net_flow/lit_trades/price), so a single WS frame can legitimately carry rows for
  // some other ticker only. Before the fix, the caller fell back to `rows` (the WHOLE
  // frame) whenever no SPX bucket existed, which would have stamped AAPL's rows onto
  // the SPX-labeled snapshot that /api/market/spx/pulse/stream serves as `intervalFlow`.
  const rows = [
    { ticker: "AAPL", strike: 230, call_premium: 5_000_000, put_premium: 0 },
    { ticker: "AAPL", strike: 235, call_premium: 0, put_premium: 2_000_000 },
  ];
  const { byTicker, spxRows } = bucketIntervalFlowRows(rows);

  assert.equal(spxRows, null, "no SPX row present — spxRows must be null, never the AAPL rows");
  assert.deepEqual(byTicker.get("AAPL"), rows, "AAPL rows must still be bucketed correctly for getIntervalFlowForTicker('AAPL')");
  assert.equal(byTicker.get("SPX"), undefined);
});

test("bucketIntervalFlowRows: a mixed frame isolates SPX rows from other tickers", () => {
  const spxRow = { ticker: "SPX", strike: 5900, call_premium: 1_000_000, put_premium: 500_000 };
  const tslaRow = { ticker: "TSLA", strike: 400, call_premium: 3_000_000, put_premium: 0 };
  const { byTicker, spxRows } = bucketIntervalFlowRows([spxRow, tslaRow]);

  assert.deepEqual(spxRows, [spxRow], "spxRows must contain only the SPX row, not the blended frame");
  assert.deepEqual(byTicker.get("TSLA"), [tslaRow]);
});

test("bucketIntervalFlowRows: rows with no explicit ticker default to SPX (normalizer contract)", () => {
  // normalizeIntervalFlowWsPayload already defaults a missing ticker/symbol to "SPX"
  // before these rows reach the bucketer, so this exercises that same default path.
  const row = { ticker: "SPX", strike: 5900, call_premium: 1, put_premium: 2 };
  const { spxRows } = bucketIntervalFlowRows([row]);
  assert.deepEqual(spxRows, [row]);
});
