import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseBucketCount,
  derivePreEntryMetrics,
  deriveOutcomeMetrics,
  deriveRowMetrics,
  bucketByVariableQuantile,
  bucketedMetricVerdict,
  pairwiseSpearman,
  baselineSummary,
} from "./banger-discovery-edge-eval.mjs";

test("chooseBucketCount: shrinks to fit, never splits a small population thinner than minPerBucket", () => {
  assert.equal(chooseBucketCount(4, { minPerBucket: 5 }), 1);
  assert.equal(chooseBucketCount(9, { minPerBucket: 5 }), 1);
  assert.equal(chooseBucketCount(10, { minPerBucket: 5 }), 2);
  assert.equal(chooseBucketCount(25, { minPerBucket: 5, maxBuckets: 5 }), 5);
  assert.equal(chooseBucketCount(1000, { minPerBucket: 5, maxBuckets: 5 }), 5);
});

test("derivePreEntryMetrics: reads only discovery/contract/calendar fields, never outcome fields", () => {
  const row = {
    discovery_gain: 0.08,
    discovery_vol: 2_000_000,
    discovery_dollar_vol: 40_000_000,
    discovery_close_strength: 0.9,
    contract_strike: 55,
    contract_expiry: "2026-08-22",
    session_date: "2026-08-15",
    entry_premium: 1.5,
    entry_context: { discovery: { close: 50, gain: 0.08 }, screen: "banger_v1" },
    // outcome fields present on the raw row but must NOT leak into pre-entry metrics
    peak_premium: 9.0,
    realized_pnl_pct: 400,
  };
  const m = derivePreEntryMetrics(row);
  assert.equal(m.discoveryGainPct, 8);
  assert.equal(m.discoveryVol, 2_000_000);
  assert.equal(m.discoveryDollarVol, 40_000_000);
  assert.equal(m.discoveryCloseStrength, 0.9);
  assert.equal(m.priceAtDiscovery, 50);
  assert.ok(Math.abs(m.otmPct - 10) < 1e-9); // 55/50 - 1 = 10% (floating point, not exactly 10)
  assert.equal(m.dteAtEntry, 7); // 2026-08-22 - 2026-08-15
  assert.equal(m.dayOfWeek, 6); // 2026-08-15 is a Saturday
  assert.equal(m.entryPremium, 1.5);
  assert.equal(Object.keys(m).includes("peakPremium"), false);
  assert.equal(Object.keys(m).includes("realizedPnlPct"), false);
});

test("derivePreEntryMetrics: missing entry_context/discovery degrades to null OTM, never fabricates a value", () => {
  const m = derivePreEntryMetrics({ contract_strike: 55, session_date: "2026-08-15", contract_expiry: "2026-08-22" });
  assert.equal(m.priceAtDiscovery, null);
  assert.equal(m.otmPct, null);
  assert.equal(m.dteAtEntry, 7);
});

test("deriveOutcomeMetrics: MFE/MAE are relative retracement from entry, not raw premium deltas", () => {
  const row = { entry_premium: 2, peak_premium: 6, trough_premium: 1, realized_pnl_pct: 150 };
  const m = deriveOutcomeMetrics(row);
  assert.equal(m.mfePct, 200); // (6/2 - 1) * 100
  assert.equal(m.maePct, -50); // (1/2 - 1) * 100
  assert.equal(m.realizedPnlPct, 150);
  assert.equal(m.is100PlusMfe, true);
  assert.equal(m.is100PlusRealized, true);
  assert.equal(m.isLoss, false);
});

test("deriveOutcomeMetrics: a loser that never traded above entry has maePct negative, mfePct near zero", () => {
  const row = { entry_premium: 2, peak_premium: 2.1, trough_premium: 0.8, realized_pnl_pct: -60 };
  const m = deriveOutcomeMetrics(row);
  assert.ok(Math.abs(m.mfePct - 5) < 1e-9);
  assert.equal(m.maePct, -60);
  assert.equal(m.isLoss, true);
  assert.equal(m.is100PlusMfe, false);
  assert.equal(m.is100PlusRealized, false);
});

test("deriveRowMetrics joins pre-entry and outcome without collision (distinct field sets)", () => {
  const row = {
    discovery_gain: 0.05, contract_strike: 21, session_date: "2026-08-10", contract_expiry: "2026-08-14",
    entry_context: { discovery: { close: 20 } }, entry_premium: 1, peak_premium: 3, trough_premium: 0.5,
    realized_pnl_pct: 80, id: 7, ticker: "ABC",
  };
  const m = deriveRowMetrics(row);
  assert.equal(m.id, 7);
  assert.equal(m.ticker, "ABC");
  assert.equal(m.discoveryGainPct, 5);
  assert.equal(m.mfePct, 200);
});

function fakeRow({ gain, realizedPnlPct, mfePct = null }) {
  const entryPremium = 1;
  const peak = mfePct != null ? entryPremium * (1 + mfePct / 100) : entryPremium * (1 + Math.max(0, realizedPnlPct) / 100);
  return {
    discovery_gain: gain / 100,
    contract_strike: 10,
    session_date: "2026-08-10",
    contract_expiry: "2026-08-14",
    entry_context: { discovery: { close: 9 } },
    entry_premium: entryPremium,
    peak_premium: peak,
    trough_premium: entryPremium * (1 - 0.3),
    realized_pnl_pct: realizedPnlPct,
  };
}

test("bucketByVariableQuantile: excludes rows missing the bucketing or outcome variable, never coerces to a bucket", () => {
  const rows = [
    deriveRowMetrics(fakeRow({ gain: 4, realizedPnlPct: -20 })),
    deriveRowMetrics({ ...fakeRow({ gain: 6, realizedPnlPct: 10 }), discovery_gain: null }), // missing bucketing var
    deriveRowMetrics(fakeRow({ gain: 8, realizedPnlPct: 30 })),
  ];
  const buckets = bucketByVariableQuantile(rows, "discoveryGainPct", "realizedPnlPct", { minPerBucket: 1 });
  const totalN = buckets.reduce((a, b) => a + b.n, 0);
  assert.equal(totalN, 2); // the null-gain row is excluded, not zero-bucketed
});

test("bucketedMetricVerdict: RANKS requires both a real spread and a monotonic trend, not spread alone", () => {
  // Monotonically increasing win rate across quantile-ordered buckets -> RANKS.
  const monotonic = [
    { label: "lo", n: 6, winRate: 10 },
    { label: "mid", n: 6, winRate: 40 },
    { label: "hi", n: 6, winRate: 80 },
  ];
  const r1 = bucketedMetricVerdict(monotonic, "winRate", { minN: 5 });
  assert.equal(r1.verdict, "RANKS");

  // Same spread, SCRAMBLED order -> must NOT be called RANKS (the exact trap this file's own
  // header cites from swing-score-calibration-eval.mjs's history).
  const scrambled = [
    { label: "lo", n: 6, winRate: 80 },
    { label: "mid", n: 6, winRate: 10 },
    { label: "hi", n: 6, winRate: 40 },
  ];
  const r2 = bucketedMetricVerdict(scrambled, "winRate", { minN: 5 });
  assert.equal(r2.verdict, "SPREAD WITHOUT ORDER");

  // Monotonically DEcreasing -> INVERTED.
  const inverted = [
    { label: "lo", n: 6, winRate: 80 },
    { label: "mid", n: 6, winRate: 40 },
    { label: "hi", n: 6, winRate: 10 },
  ];
  const r3 = bucketedMetricVerdict(inverted, "winRate", { minN: 5 });
  assert.equal(r3.verdict, "INVERTED");
});

test("bucketedMetricVerdict: FLAT when spread is below threshold regardless of trend", () => {
  const flat = [
    { label: "lo", n: 6, winRate: 41 },
    { label: "mid", n: 6, winRate: 43 },
    { label: "hi", n: 6, winRate: 44 },
  ];
  const r = bucketedMetricVerdict(flat, "winRate", { minN: 5, spreadThreshold: 5 });
  assert.equal(r.verdict, "FLAT");
});

test("bucketedMetricVerdict: thin buckets are named in excluded[], not silently dropped or trusted", () => {
  const mixed = [
    { label: "lo", n: 2, winRate: 90 }, // below minN
    { label: "mid", n: 6, winRate: 40 },
    { label: "hi", n: 6, winRate: 20 },
  ];
  const r = bucketedMetricVerdict(mixed, "winRate", { minN: 5 });
  assert.deepEqual(r.excluded, ["lo(n=2)"]);
  assert.equal(r.usableBuckets, 2);
});

test("bucketedMetricVerdict: INSUFFICIENT DATA when fewer than 2 usable buckets", () => {
  const thin = [{ label: "only", n: 20, winRate: 50 }];
  const r = bucketedMetricVerdict(thin, "winRate", { minN: 5 });
  assert.equal(r.verdict, "INSUFFICIENT DATA");
});

test("pairwiseSpearman: n<4 reports not-computed rather than a noisy correlation", () => {
  const rows = [
    deriveRowMetrics(fakeRow({ gain: 4, realizedPnlPct: -20 })),
    deriveRowMetrics(fakeRow({ gain: 8, realizedPnlPct: 30 })),
  ];
  const r = pairwiseSpearman(rows, "discoveryGainPct", "realizedPnlPct");
  assert.equal(r.rho, null);
  assert.match(r.note, /n<4/);
});

test("pairwiseSpearman: perfectly monotonic relationship yields rho near 1", () => {
  const rows = [
    deriveRowMetrics(fakeRow({ gain: 4, realizedPnlPct: -50 })),
    deriveRowMetrics(fakeRow({ gain: 6, realizedPnlPct: -10 })),
    deriveRowMetrics(fakeRow({ gain: 8, realizedPnlPct: 40 })),
    deriveRowMetrics(fakeRow({ gain: 10, realizedPnlPct: 120 })),
  ];
  const r = pairwiseSpearman(rows, "discoveryGainPct", "realizedPnlPct");
  assert.equal(r.n, 4);
  assert.ok(r.rho > 0.99, `expected rho near 1, got ${r.rho}`);
});

test("baselineSummary: unconditional population rate, always computable before any segmentation", () => {
  const rows = [
    deriveRowMetrics(fakeRow({ gain: 4, realizedPnlPct: -50 })),
    deriveRowMetrics(fakeRow({ gain: 6, realizedPnlPct: 120 })),
    deriveRowMetrics(fakeRow({ gain: 8, realizedPnlPct: 40 })),
  ];
  const b = baselineSummary(rows);
  assert.equal(b.n, 3);
  assert.equal(b.winRate, Math.round((2 / 3) * 100 * 100) / 100);
  assert.equal(b.hit100RealizedRate, Math.round((1 / 3) * 100 * 100) / 100);
});
