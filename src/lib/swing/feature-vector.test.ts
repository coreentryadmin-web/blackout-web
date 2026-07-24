import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSwingFeatureVector,
  numericVector,
  SWING_FEATURE_VECTOR_VERSION,
  SWING_NUMERIC_FEATURE_KEYS,
  SWING_CATEGORICAL_FEATURE_KEYS,
  type SwingFeatureInputs,
} from "./feature-vector.ts";

const base: SwingFeatureInputs = {
  ticker: "nvda",
  direction: "long",
  archetype: "BREAKOUT",
  subLane: "STANDARD",
  evidenceScore: 78,
  pillars: { STRUCTURE: 0.8, REL_STRENGTH: 0.7, FLOW: 0.6 },
  presentPillars: 3,
  dataQualityDegraded: false,
  dteRemaining: 14,
  runningMfe: 5.2,
  runningMae: -1.1,
  underlyingPx: 120.5,
  optionMark: 6.0,
  entryPremium: 4.0,
  thesisState: "intact",
  snapshotKind: "eod",
  snapshotSeq: 2,
  sessionsElapsed: 2,
};

// ── versioning ─────────────────────────────────────────────────────────────────
test("feature vector is versioned via `v`", () => {
  const v = buildSwingFeatureVector(base);
  assert.equal(v.v, SWING_FEATURE_VECTOR_VERSION);
  assert.equal(SWING_FEATURE_VECTOR_VERSION, 1);
});

// ── one-hot archetype + sub-lane ─────────────────────────────────────────────────
test("archetype + sub-lane one-hot: winner=1, others=0, unknown=null throughout", () => {
  const v = buildSwingFeatureVector(base);
  assert.equal(v.arch_breakout, 1);
  assert.equal(v.arch_mean_reversion, 0);
  assert.equal(v.arch_event_driven, 0);
  assert.equal(v.lane_standard, 1);
  assert.equal(v.lane_tactical, 0);
  assert.equal(v.lane_extended, 0);

  const unknown = buildSwingFeatureVector({ ...base, archetype: null, subLane: null });
  // Unknown category => null (not a fabricated 0 that reads as "definitely not this class").
  assert.equal(unknown.arch_breakout, null);
  assert.equal(unknown.lane_standard, null);
  assert.equal(unknown.archetype, null);
  assert.equal(unknown.sub_lane, null);
});

// ── null-safety (numOrNull; non-finite → null; missing pillars → null not 0) ──────
test("null-safe: missing / non-finite numerics collapse to null, never a fabricated 0", () => {
  const v = buildSwingFeatureVector({
    ticker: "SPY",
    direction: "short",
    dteRemaining: NaN,
    runningMfe: Infinity,
    evidenceScore: undefined,
    optionMark: null,
    // pillars omitted entirely
  });
  assert.equal(v.dte_remaining, null);
  assert.equal(v.running_mfe, null);
  assert.equal(v.evidence_score, null);
  assert.equal(v.option_mark, null);
  assert.equal(v.pil_structure, null); // absent pillar is null, NOT 0
  assert.equal(v.pil_flow, null);
  assert.equal(v.dq_degraded, null); // unknown flag is null, not 0
});

test("option_return_pct only when entry premium is real; null otherwise", () => {
  assert.equal(buildSwingFeatureVector(base).option_return_pct, 50); // 6/4 - 1 = 50%
  assert.equal(buildSwingFeatureVector({ ...base, entryPremium: null }).option_return_pct, null);
  assert.equal(buildSwingFeatureVector({ ...base, entryPremium: 0 }).option_return_pct, null);
});

test("ticker uppercased, side echoed", () => {
  const v = buildSwingFeatureVector(base);
  assert.equal(v.ticker, "NVDA");
  assert.equal(v.side, "long");
});

// ── numericVector positional + null-preserving ───────────────────────────────────
test("numericVector is positional and preserves nulls (never coerces to 0)", () => {
  const v = buildSwingFeatureVector({ ...base, dteRemaining: null });
  const vec = numericVector(v);
  assert.equal(vec.length, SWING_NUMERIC_FEATURE_KEYS.length);
  const dteIdx = SWING_NUMERIC_FEATURE_KEYS.indexOf("dte_remaining");
  assert.equal(vec[dteIdx], null); // missing feature is null in the vector, not 0
  const evIdx = SWING_NUMERIC_FEATURE_KEYS.indexOf("evidence_score");
  assert.equal(vec[evIdx], 78);
});

test("numeric + categorical key lists are disjoint and reference real fields", () => {
  const v = buildSwingFeatureVector(base);
  for (const k of SWING_NUMERIC_FEATURE_KEYS) assert.ok(k in v);
  for (const k of SWING_CATEGORICAL_FEATURE_KEYS) assert.ok(k in v);
  const overlap = SWING_NUMERIC_FEATURE_KEYS.filter((k) =>
    (SWING_CATEGORICAL_FEATURE_KEYS as readonly string[]).includes(k)
  );
  assert.equal(overlap.length, 0);
});
