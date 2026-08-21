import test from "node:test";
import assert from "node:assert/strict";
import {
  trailingSkewBaseline,
  MIN_BASELINE_SESSIONS,
  IQR_OUTLIER_FENCE,
} from "./helix-skew-baseline";

/** A baseline of `n` values evenly spread 40..60 (median ~50), for placement tests. */
function evenBaseline(n: number, lo = 40, hi = 60): number[] {
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

test("withholds a verdict below the minimum measured sessions — never a norm off a handful", () => {
  const r = trailingSkewBaseline(evenBaseline(MIN_BASELINE_SESSIONS - 1), 78);
  assert.equal(r.available, false);
  if (r.available === false) {
    assert.equal(r.reason, "insufficient_history");
    assert.equal(r.measured_sessions, MIN_BASELINE_SESSIONS - 1);
    assert.equal(r.min_sessions, MIN_BASELINE_SESSIONS);
  }
});

test("a null/unmeasurable prior session is EXCLUDED from the baseline, never counted as 0 or 50", () => {
  // 10 measured + 3 nulls. If nulls were counted as 0 the median would crater; they must be dropped.
  const prior = [...evenBaseline(10, 55, 65), null, undefined, Number.NaN];
  const r = trailingSkewBaseline(prior, 60);
  assert.equal(r.available, true);
  if (r.available) {
    assert.equal(r.measured_sessions, 10, "only the 10 finite values count");
    assert.ok(r.median_call_pct >= 55 && r.median_call_pct <= 65, "median reflects the real values, not zeros");
  }
});

test("today's own value is NOT folded into the distribution it is compared against", () => {
  // Baseline is all 50. Today is 90 — an outlier. If today leaked into the baseline the p75/fence
  // would shift toward it and it could read 'typical'. It must read unusual.
  const r = trailingSkewBaseline(Array.from({ length: 12 }, () => 50), 90);
  assert.equal(r.available, true);
  if (r.available) {
    assert.equal(r.median_call_pct, 50, "baseline is the priors only");
    assert.equal(r.p75_call_pct, 50);
    assert.equal(r.placement, "unusually_high");
    assert.equal(r.unusual, true);
  }
});

test("computes median/p25/p75/iqr for a known series", () => {
  // 0,10,20,...,100 (11 values). type-7 percentiles: p25=25, p50=50, p75=75.
  const r = trailingSkewBaseline(Array.from({ length: 11 }, (_, i) => i * 10), 50);
  assert.equal(r.available, true);
  if (r.available) {
    assert.equal(r.median_call_pct, 50);
    assert.equal(r.p25_call_pct, 25);
    assert.equal(r.p75_call_pct, 75);
    assert.equal(r.iqr, 50);
  }
});

test("placement classifies typical / above / below the interquartile band", () => {
  const base = trailingSkewBaseline(evenBaseline(21, 40, 60), 50); // p25=45, p75=55, iqr=10
  assert.equal(base.available, true);
  if (!base.available) return;
  assert.equal(base.p25_call_pct, 45);
  assert.equal(base.p75_call_pct, 55);

  assert.equal((trailingSkewBaseline(evenBaseline(21, 40, 60), 50) as any).placement, "typical");
  assert.equal((trailingSkewBaseline(evenBaseline(21, 40, 60), 58) as any).placement, "above_normal");
  assert.equal((trailingSkewBaseline(evenBaseline(21, 40, 60), 42) as any).placement, "below_normal");
});

test("placement flags unusual only beyond the 1.5x IQR fence", () => {
  // p25=45, p75=55, iqr=10 → upper fence = 55 + 15 = 70, lower fence = 45 - 15 = 30.
  const upper = trailingSkewBaseline(evenBaseline(21, 40, 60), 71) as any;
  assert.equal(upper.placement, "unusually_high");
  assert.equal(upper.unusual, true);
  const lower = trailingSkewBaseline(evenBaseline(21, 40, 60), 29) as any;
  assert.equal(lower.placement, "unusually_low");
  assert.equal(lower.unusual, true);
  // Just inside the fence is high-but-not-unusual.
  const inside = trailingSkewBaseline(evenBaseline(21, 40, 60), 69) as any;
  assert.equal(inside.placement, "above_normal");
  assert.equal(inside.unusual, false, "measured-and-ordinary is false, not null");
  assert.equal(IQR_OUTLIER_FENCE, 1.5);
});

test("today null still returns the norm, with placement/percentile/unusual all null (never invented)", () => {
  const r = trailingSkewBaseline(evenBaseline(12, 40, 60), null);
  assert.equal(r.available, true);
  if (r.available) {
    assert.ok(Number.isFinite(r.median_call_pct), "the norm is a fact even when today has no reading");
    assert.equal(r.today_call_pct, null);
    assert.equal(r.today_percentile, null);
    assert.equal(r.placement, null);
    assert.equal(r.unusual, null);
  }
});

test("today_percentile is the mid-rank — a value at the median lands near 50, not 100", () => {
  const r = trailingSkewBaseline(Array.from({ length: 11 }, (_, i) => i * 10), 50) as any;
  // 5 below 50, 1 equal, 5 above → (5 + 0.5) / 11 * 100 ≈ 50.
  assert.ok(Math.abs(r.today_percentile - 50) < 0.01, `expected ~50, got ${r.today_percentile}`);
});
