import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRelativeVolume,
  buildTimeOfDayVolumeProfile,
  RVOL_VERY_HIGH,
  RVOL_HIGH,
  RVOL_LOW,
  RVOL_PROFILE_MIN_DAYS,
} from "./relative-volume.ts";

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

test("computeRelativeVolume: omitting timeOfDayProfile is byte-identical to the original flat-proration behavior", () => {
  const avgDaily = 10_000_000;
  const expectedByNow = avgDaily * (180 / 390);
  const r = computeRelativeVolume({ cumulativeVolumeToday: expectedByNow, avgDailyVolume: avgDaily, nowMs: etMs(12, 30) });
  assert.ok(Math.abs(r.ratio! - 1) < 0.01);
  assert.equal(r.expected_fraction_source, "flat_proration");
});

test("computeRelativeVolume: a malformed timeOfDayProfile (wrong length) falls back to flat proration, never throws", () => {
  const avgDaily = 10_000_000;
  const r = computeRelativeVolume({
    cumulativeVolumeToday: 1_000_000,
    avgDailyVolume: avgDaily,
    nowMs: etMs(12, 30),
    timeOfDayProfile: { cumulativeFractionByMinute: [0.1, 0.2], days_used: 10 },
  });
  assert.equal(r.expected_fraction_source, "flat_proration");
});

// buildTimeOfDayVolumeProfile — the real, measured curve.
const RTH_MIN = 390;

function flatDay(perMinute: number): number[] {
  return new Array(RTH_MIN).fill(perMinute);
}

function uShapedDay(openSpike: number, middayPace: number, closeSpike: number): number[] {
  const day = new Array(RTH_MIN).fill(middayPace);
  for (let i = 0; i < 15; i++) day[i] = openSpike;
  for (let i = RTH_MIN - 15; i < RTH_MIN; i++) day[i] = closeSpike;
  return day;
}

test("buildTimeOfDayVolumeProfile: returns null with fewer than RVOL_PROFILE_MIN_DAYS real days", () => {
  const days = new Array(RVOL_PROFILE_MIN_DAYS - 1).fill(0).map(() => flatDay(1000));
  assert.equal(buildTimeOfDayVolumeProfile(days), null);
});

test("buildTimeOfDayVolumeProfile: returns null when every supplied day is all-zero (no real volume)", () => {
  const days = new Array(RVOL_PROFILE_MIN_DAYS + 2).fill(0).map(() => flatDay(0));
  assert.equal(buildTimeOfDayVolumeProfile(days), null);
});

test("buildTimeOfDayVolumeProfile: a FLAT historical pace reproduces the flat-proration curve almost exactly", () => {
  const days = new Array(10).fill(0).map(() => flatDay(1000));
  const profile = buildTimeOfDayVolumeProfile(days);
  assert.ok(profile != null);
  assert.equal(profile!.days_used, 10);
  // At the midpoint of a perfectly flat day, cumulative fraction should be ~0.5 (180/390 elapsed
  // minutes after minute index 179 => fraction (180)/390).
  assert.ok(Math.abs(profile!.cumulativeFractionByMinute[179] - 180 / 390) < 1e-6);
  // Last minute's cumulative fraction is ~1 (the whole day's own average volume).
  assert.ok(Math.abs(profile!.cumulativeFractionByMinute[RTH_MIN - 1] - 1) < 1e-6);
  // Monotonically non-decreasing.
  for (let i = 1; i < RTH_MIN; i++) {
    assert.ok(profile!.cumulativeFractionByMinute[i] >= profile!.cumulativeFractionByMinute[i - 1]);
  }
});

test("buildTimeOfDayVolumeProfile: a real U-shaped pace front-loads MORE cumulative fraction by midday than flat proration would", () => {
  const days = new Array(10).fill(0).map(() => uShapedDay(5000, 500, 5000));
  const profile = buildTimeOfDayVolumeProfile(days)!;
  // Flat proration would say 180/390 = 46.15% of the day's volume has traded by minute 179.
  // The real U-shaped pace front-loads the open spike, so the true cumulative fraction by the same
  // clock minute is HIGHER than the flat assumption — the exact distortion this module exists to fix.
  const flatFraction = 180 / 390;
  assert.ok(
    profile.cumulativeFractionByMinute[179] > flatFraction,
    `expected U-shaped midday cumulative fraction (${profile.cumulativeFractionByMinute[179]}) to exceed flat (${flatFraction})`
  );
});

test("computeRelativeVolume: a real U-shaped profile reclassifies ordinary open-minute volume as normal instead of falsely very_high", () => {
  const avgDaily = 10_000_000;
  const days = new Array(10).fill(0).map(() => uShapedDay(50_000, 10_000, 50_000));
  const profile = buildTimeOfDayVolumeProfile(days)!;
  // Minute 10 (10 minutes after the open, clears RVOL_MIN_ELAPSED_MINUTES): an ordinary name trading
  // its OWN typical open-spike pace should read ~1.0x under the profile, even though the same
  // absolute volume read against FLAT proration (which assumes a tiny expectation this early) would
  // read as a wildly inflated false "very_high".
  const elapsedMinute = 10;
  const totalAvgVolume = 50_000 * 15 + 10_000 * (RTH_MIN - 30) + 50_000 * 15;
  const expectedShareByMinute10 = profile.cumulativeFractionByMinute[elapsedMinute] * avgDaily;
  const todayVolumeAtTypicalPace = expectedShareByMinute10; // trading exactly its own historical pace
  void totalAvgVolume;

  const withProfile = computeRelativeVolume({
    cumulativeVolumeToday: todayVolumeAtTypicalPace,
    avgDailyVolume: avgDaily,
    nowMs: etMs(9, 30 + elapsedMinute),
    timeOfDayProfile: profile,
  });
  const withoutProfile = computeRelativeVolume({
    cumulativeVolumeToday: todayVolumeAtTypicalPace,
    avgDailyVolume: avgDaily,
    nowMs: etMs(9, 30 + elapsedMinute),
  });

  assert.equal(withProfile.expected_fraction_source, "time_of_day_profile");
  assert.ok(Math.abs(withProfile.ratio! - 1) < 0.02, `expected ~1.0x under the real profile, got ${withProfile.ratio}`);
  assert.equal(withProfile.classification, "normal");

  assert.equal(withoutProfile.expected_fraction_source, "flat_proration");
  assert.ok(
    withoutProfile.ratio! > withProfile.ratio!,
    "flat proration must overstate the ratio at the open relative to the real U-shaped profile"
  );
});
