import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeTickerGreekFlow } from "./ticker-greek-flow-summary";

// Real sampled row shape from UW's /api/stock/{ticker}/greek-flow, captured live 2026-09-02
// (AAPL) while verifying the blast radius of the group-flow finding in FINDINGS.md — the
// per-ticker endpoint carries the identical shape (no gamma field, dir_delta_flow for signed net
// delta) as the group-flow endpoint that finding characterized, so scoreCandidate's dealer
// greek-flow alignment bonus (scorer.ts) has never fired for any ticker in production.
function realAaplRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    timestamp: "2026-09-01T13:30:00Z",
    ticker: "AAPL",
    transactions: 1705,
    volume: 7828,
    dir_delta_flow: "2969.947258259546611800",
    dir_vega_flow: "-3598.077184456450141600",
    otm_dir_delta_flow: "-12469.181997548664588200",
    otm_dir_vega_flow: "-4995.447958441842659600",
    otm_total_delta_flow: "90002.337247302451158700",
    otm_total_vega_flow: "65836.206546183631821400",
    total_delta_flow: "114146.405770920168358700",
    total_vega_flow: "78301.090749966779155400",
    ...overrides,
  };
}

test("summarizeTickerGreekFlow no longer returns null against a real UW per-ticker row — the regression this guards", () => {
  const summary = summarizeTickerGreekFlow([realAaplRow()]);
  assert.notEqual(summary, null);
  assert.equal(summary?.net_delta, 2969.9472582595466118);
});

test("summarizeTickerGreekFlow reports net_gamma as null (not a fabricated 0) — this endpoint has no gamma field", () => {
  const summary = summarizeTickerGreekFlow([realAaplRow()]);
  assert.equal(summary?.net_gamma, null);
});

test("summarizeTickerGreekFlow still honors an explicit net_gamma field when one IS present", () => {
  const summary = summarizeTickerGreekFlow([{ net_delta: 1000, net_gamma: 42 }]);
  assert.equal(summary?.net_gamma, 42);
});

test("summarizeTickerGreekFlow bias reflects real per-minute AAPL flow direction (bullish above +10K)", () => {
  const bullish = summarizeTickerGreekFlow([
    realAaplRow({ dir_delta_flow: "15000" }),
  ]);
  assert.equal(bullish?.bias, "bullish");

  const bearish = summarizeTickerGreekFlow([
    realAaplRow({ dir_delta_flow: "-15000" }),
  ]);
  assert.equal(bearish?.bias, "bearish");
});

test("summarizeTickerGreekFlow returns null on empty rows", () => {
  assert.equal(summarizeTickerGreekFlow([]), null);
});
