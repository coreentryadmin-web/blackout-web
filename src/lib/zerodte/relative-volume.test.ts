import test from "node:test";
import assert from "node:assert/strict";
import { computeRelativeVolume, RVOL_VERY_HIGH, RVOL_HIGH, RVOL_LOW } from "./relative-volume.ts";

// ET epoch-ms helper: 2026-10-19 is a real EDT (UTC-4) trading day used elsewhere in this repo's
// fixtures this session. 13:30 UTC = 9:30 ET (the open).
const etMs = (h: number, m = 0) => Date.parse(`2026-10-19T${String(h + 4).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

test("computeRelativeVolume returns null ratio before RTH open", () => {
  const r = computeRelativeVolume({ cumulativeVolumeToday: 1_000_000, avgDailyVolume: 10_000_000, nowMs: etMs(8) });
  assert.equal(r.ratio, null);
  assert.equal(r.classification, null);
  assert.equal(r.session_fraction_elapsed, null);
});

test("computeRelativeVolume returns null ratio at/after the close (exclusive bound)", () => {
  const r = computeRelativeVolume({ cumulativeVolumeToday: 9_000_000, avgDailyVolume: 10_000_000, nowMs: etMs(16) });
  assert.equal(r.ratio, null);
  assert.equal(r.session_fraction_elapsed, null);
});

test("computeRelativeVolume returns null in the first few minutes of RTH (floor guard)", () => {
  const r = computeRelativeVolume({ cumulativeVolumeToday: 500_000, avgDailyVolume: 10_000_000, nowMs: etMs(9, 31) });
  assert.equal(r.ratio, null, "1 minute elapsed is below RVOL_MIN_ELAPSED_MINUTES");
});

test("computeRelativeVolume: exactly-average pace at midday reads ratio ~1.0, classification normal", () => {
  // 9:30-12:30 ET = 180 of 390 RTH minutes elapsed = 0.4615 of the session.
  const avgDaily = 10_000_000;
  const expectedByNow = avgDaily * (180 / 390);
  const r = computeRelativeVolume({ cumulativeVolumeToday: expectedByNow, avgDailyVolume: avgDaily, nowMs: etMs(12, 30) });
  assert.ok(r.ratio != null);
  assert.ok(Math.abs(r.ratio! - 1) < 0.01, `expected ~1.0, got ${r.ratio}`);
  assert.equal(r.classification, "normal");
  // session_fraction_elapsed is rounded to 4dp for display — tolerance must exceed that rounding
  // step (180/390 = 0.461538..., rounds to 0.4615, a ~3.8e-5 gap), not just floating-point noise.
  assert.ok(Math.abs(r.session_fraction_elapsed! - 180 / 390) < 1e-4);
});

test("computeRelativeVolume classifies very_high at/above 2x pace", () => {
  const avgDaily = 10_000_000;
  const expectedByNow = avgDaily * (100 / 390);
  const r = computeRelativeVolume({
    cumulativeVolumeToday: expectedByNow * RVOL_VERY_HIGH,
    avgDailyVolume: avgDaily,
    nowMs: etMs(11, 10),
  });
  assert.equal(r.classification, "very_high");
  assert.ok(r.ratio! >= RVOL_VERY_HIGH - 1e-6);
});

test("computeRelativeVolume classifies high in [1.5x, 2x) pace", () => {
  const avgDaily = 10_000_000;
  const expectedByNow = avgDaily * (100 / 390);
  const r = computeRelativeVolume({
    cumulativeVolumeToday: expectedByNow * (RVOL_HIGH + 0.1),
    avgDailyVolume: avgDaily,
    nowMs: etMs(11, 10),
  });
  assert.equal(r.classification, "high");
});

test("computeRelativeVolume classifies low below 0.5x pace", () => {
  const avgDaily = 10_000_000;
  const expectedByNow = avgDaily * (100 / 390);
  const r = computeRelativeVolume({
    cumulativeVolumeToday: expectedByNow * (RVOL_LOW - 0.1),
    avgDailyVolume: avgDaily,
    nowMs: etMs(11, 10),
  });
  assert.equal(r.classification, "low");
});

test("computeRelativeVolume never fabricates a ratio from a non-finite or non-positive avgDailyVolume", () => {
  for (const bad of [0, -5, NaN, Infinity]) {
    const r = computeRelativeVolume({ cumulativeVolumeToday: 1_000_000, avgDailyVolume: bad, nowMs: etMs(11) });
    assert.equal(r.ratio, null, `avgDailyVolume=${bad} must not produce a ratio`);
  }
});

test("computeRelativeVolume never fabricates a ratio from a negative or non-finite cumulative volume", () => {
  for (const bad of [-1, NaN, Infinity]) {
    const r = computeRelativeVolume({ cumulativeVolumeToday: bad, avgDailyVolume: 10_000_000, nowMs: etMs(11) });
    assert.equal(r.ratio, null, `cumulativeVolumeToday=${bad} must not produce a ratio`);
  }
});

test("computeRelativeVolume: zero volume so far is a real (not null) very-low reading, not an absence", () => {
  const r = computeRelativeVolume({ cumulativeVolumeToday: 0, avgDailyVolume: 10_000_000, nowMs: etMs(11) });
  assert.equal(r.ratio, 0);
  assert.equal(r.classification, "low");
});

test("computeRelativeVolume is pure and deterministic across repeated calls", () => {
  const input = { cumulativeVolumeToday: 3_456_789, avgDailyVolume: 12_345_678, nowMs: etMs(14, 7) };
  const a = computeRelativeVolume(input);
  const b = computeRelativeVolume(input);
  assert.deepEqual(a, b);
});
