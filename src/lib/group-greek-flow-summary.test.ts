import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeGroupGreekFlow } from "./group-greek-flow-summary";

// Real sampled row shape from UW's /api/group-flow/mag7/greek-flow, captured live 2026-08-29 and
// re-confirmed 2026-09-02 (FINDINGS.md, "summarizeGroupGreekFlow reads field names that don't
// exist in the real UW response — always returns null"). This endpoint carries NO gamma field
// at all — only delta/vega/premium/volume keys, and the real net-delta field is `dir_delta_flow`,
// not `net_delta`/`delta`/`net_deltas`.
function realMag7Row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    timestamp: "2026-08-28T13:30:00Z",
    transactions: 19985,
    volume: 114624,
    flow_group: "mag7",
    net_call_volume: 5247,
    net_call_premium: "5396993.00",
    net_put_volume: -4844,
    net_put_premium: "126779.0000",
    dir_delta_flow: "308034.7794623153583075000",
    dir_vega_flow: "150179.6952321463253319000",
    otm_dir_delta_flow: "133454.5984677336416875000",
    otm_dir_vega_flow: "116039.0750319682828980500",
    otm_net_call_premium: "2521181.00",
    otm_net_call_volume: 2681,
    otm_net_put_premium: "116596.00",
    otm_net_put_volume: -4927,
    otm_total_delta_flow: "877546.1264256275621754300",
    otm_total_vega_flow: "637902.2087909039674435600",
    total_delta_flow: "1578426.2143724109873554300",
    total_vega_flow: "824468.2845911837618771100",
    ...overrides,
  };
}

test("summarizeGroupGreekFlow no longer returns null against a real UW group-flow row — the regression this guards", () => {
  const summary = summarizeGroupGreekFlow("mag7", [realMag7Row()]);
  assert.notEqual(summary, null, "must not collapse to null on a real, non-empty row");
  assert.equal(summary?.net_delta, 308034.7794623153583075, "reads dir_delta_flow as net delta");
});

test("summarizeGroupGreekFlow reports net_gamma as null (not a fabricated 0) when the data source has no gamma field", () => {
  const summary = summarizeGroupGreekFlow("mag7", [realMag7Row(), realMag7Row({ timestamp: "t2" })]);
  assert.equal(summary?.net_gamma, null);
});

test("summarizeGroupGreekFlow's headline says 'delta flow', never 'gamma', when gamma was never measured", () => {
  const bullish = summarizeGroupGreekFlow("mag7", [realMag7Row()]);
  assert.match(bullish!.headline, /delta flow/);
  assert.doesNotMatch(bullish!.headline, /dealer gamma/);
});

test("summarizeGroupGreekFlow does not use total_delta_flow as the net-delta source", () => {
  // total_delta_flow (~1.58M) is a magnitude/activity sum, not a signed net — using it would both
  // overstate the magnitude and, on rows where direction differs, get the sign wrong.
  const summary = summarizeGroupGreekFlow("mag7", [realMag7Row()]);
  assert.notEqual(summary?.net_delta, 1578426.2143724109873554);
});

test("summarizeGroupGreekFlow still honors an explicit net_gamma field when one IS present (a different data source)", () => {
  const summary = summarizeGroupGreekFlow("mag7", [
    { net_delta: 10_000, net_gamma: 500 },
  ]);
  assert.equal(summary?.net_gamma, 500);
  assert.match(summary!.headline, /dealer gamma/);
});

test("summarizeGroupGreekFlow returns null on a genuinely empty row set", () => {
  assert.equal(summarizeGroupGreekFlow("mag7", []), null);
});

test("summarizeGroupGreekFlow returns null when every row is truly empty (no delta, no gamma)", () => {
  assert.equal(summarizeGroupGreekFlow("mag7", [{ timestamp: "t", transactions: 0 }]), null);
});

test("summarizeGroupGreekFlow bias is delta-only (supportive/opposing) when gamma is unmeasured", () => {
  const supportive = summarizeGroupGreekFlow("mag7", [realMag7Row()]);
  assert.equal(supportive?.bias, "supportive"); // net delta ~308K > 50K threshold

  const opposing = summarizeGroupGreekFlow("mag7", [
    realMag7Row({ dir_delta_flow: "-308034.0" }),
  ]);
  assert.equal(opposing?.bias, "opposing");
});
