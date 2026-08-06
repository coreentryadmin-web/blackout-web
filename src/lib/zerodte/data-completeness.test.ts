import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDataCompletenessScore,
  COMPLETENESS_TRACKED_FIELDS,
} from "./data-completeness.ts";
import { buildSetupFeatureVector, type SetupFeatureInputs } from "./feature-vector.ts";
import { computeFlowQuality, type FlowPrint } from "./flow-quality.ts";
import { classifyRegime } from "./regime.ts";

const T0 = Date.parse("2026-07-23T14:00:00Z");
function fp(over: Partial<FlowPrint>): FlowPrint {
  return { premiumUsd: 300_000, askPct: 74, isSweep: true, strike: 100, expiryYmd: "2026-07-23", side: "call", tsMs: T0, ...over };
}
const strongFlow = computeFlowQuality(
  Array.from({ length: 12 }, (_, i) => fp({ premiumUsd: 200_000 + i * 40_000, tsMs: T0 + i * 90_000 }))
);
const trendRegime = classifyRegime({
  open: 600, last: 610, high: 611, low: 599, prevClose: 600, prevHigh: 602, prevLow: 596,
  vwap: 605, atr: 8, vwapCrosses: 1, vix: 18, dateYmd: "2026-06-19", isFedDay: true,
});

/** Every optional field threaded — the "fully warm" commit. */
function fullInputs(over: Partial<SetupFeatureInputs> = {}): SetupFeatureInputs {
  return {
    ticker: "spy", direction: "long", etMinutes: 65, evidenceScore: 82, dossierScore: 74,
    flowQuality: strongFlow, regime: trendRegime,
    vwapDistPct: 0.4, orBreak: "above", trend5m: "up", rsi14: 58, relVolume: 2.4, atr14: 7.1,
    gammaRegime: "positive", gexKingDistPct: 1.2, darkPoolBias: "bullish",
    vix: 18, spyBias: "up", confluence: "double",
    discoveryOrigin: ["FLOW"], contractHorizon: "ZERO_DTE", actualDteAtCommit: 0,
    strategyConfigHash: "abc123", directionOwner: "FLOW", mergePolicyVersion: "v1",
    ...over,
  };
}

/** Nothing optional threaded — only the required core fields the vector always sets. */
function bareInputs(): SetupFeatureInputs {
  return { ticker: "spy", direction: "long", etMinutes: 65, evidenceScore: 82 };
}

test("all fields present -> COMPLETE, score 1, no missing", () => {
  const v = buildSetupFeatureVector(fullInputs());
  const r = computeDataCompletenessScore(v);
  assert.equal(r.verdict, "COMPLETE");
  assert.equal(r.score, 1);
  assert.equal(r.missing_fields, 0);
  assert.deepEqual(r.missing_field_names, []);
  assert.equal(r.total_fields, COMPLETENESS_TRACKED_FIELDS.length);
  assert.equal(r.present_fields, r.total_fields);
  for (const g of r.by_group) assert.equal(g.fraction, 1, `${g.group} should be fully present`);
});

test("all optional fields absent -> BLIND, score 0", () => {
  const v = buildSetupFeatureVector(bareInputs());
  const r = computeDataCompletenessScore(v);
  assert.equal(r.verdict, "BLIND");
  assert.equal(r.score, 0);
  assert.equal(r.present_fields, 0);
  assert.equal(r.missing_fields, r.total_fields);
  for (const g of r.by_group) assert.equal(g.fraction, 0, `${g.group} should be fully absent`);
  for (const g of r.by_group) assert.equal(g.present.length, 0);
});

test("several fields missing (flowQuality + regime not threaded, rest present) -> PARTIAL with the right groups flagged", () => {
  const v = buildSetupFeatureVector(fullInputs({ flowQuality: null, regime: null }));
  const r = computeDataCompletenessScore(v);
  assert.equal(r.verdict, "PARTIAL");
  assert.ok(r.score > 0 && r.score < 1);

  const fq = r.by_group.find((g) => g.group === "flow_quality")!;
  assert.equal(fq.fraction, 0);
  assert.equal(fq.missing.length, fq.present.length + fq.missing.length);

  const reg = r.by_group.find((g) => g.group === "regime")!;
  assert.equal(reg.fraction, 0);

  // Untouched groups stay fully present.
  const market = r.by_group.find((g) => g.group === "market")!;
  assert.equal(market.fraction, 1);
  const provenance = r.by_group.find((g) => g.group === "provenance")!;
  assert.equal(provenance.fraction, 1);

  assert.ok(r.missing_field_names.includes("fq_score"));
  assert.ok(r.missing_field_names.includes("reg_structure"));
  assert.ok(!r.missing_field_names.includes("vix")); // market group untouched
});

test("a single missing dossier_score only dents its own group, not others", () => {
  const v = buildSetupFeatureVector(fullInputs({ dossierScore: null }));
  const r = computeDataCompletenessScore(v);
  assert.equal(r.verdict, "PARTIAL");
  assert.equal(r.missing_fields, 1);
  const dossier = r.by_group.find((g) => g.group === "dossier")!;
  assert.equal(dossier.fraction, 0);
  assert.deepEqual(dossier.missing, ["dossier_score"]);
});

test("0 and false-like real values count as PRESENT, never fabricated as missing", () => {
  // reg_opex/reg_quad/reg_fed are 0/1 encoded booleans; fq_accelerating is 0|1|null.
  // A real 0 must not be mistaken for "not threaded".
  const flatRegime = classifyRegime({
    open: 600, last: 600, high: 600, low: 600, prevClose: 600, prevHigh: 600, prevLow: 600,
    vwap: 600, atr: 1, vwapCrosses: 0, vix: 15, dateYmd: "2026-07-22", isFedDay: false,
  });
  const v = buildSetupFeatureVector(fullInputs({ regime: flatRegime }));
  const r = computeDataCompletenessScore(v);
  const reg = r.by_group.find((g) => g.group === "regime")!;
  assert.equal(reg.fraction, 1, "reg_opex=0/reg_fed=0 must still count as present");
  assert.equal(v.reg_opex, 0);
});

test("COMPLETENESS_TRACKED_FIELDS excludes the always-present core identity fields", () => {
  for (const core of ["v", "ticker", "side", "tod_min", "evidence_score"] as const) {
    assert.ok(!COMPLETENESS_TRACKED_FIELDS.includes(core), `${core} should not be a tracked completeness field`);
  }
});
