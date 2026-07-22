import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alphaForPct,
  markerSizeForPct,
  markerSizeForPctRel,
  alphaForPctRel,
  relStrengthT,
  radiusForPct,
  widthForPct,
  growthModulation,
  magnitudeGlowBoost,
  MODELED_ALPHA_SCALE,
  haloRingForTier,
} from "./vector-wall-visual";

test("alphaForPct: a 0% wall gets the faint visual floor, not fully invisible", () => {
  assert.equal(alphaForPct(0), 0.05);
});

test("alphaForPct: a wall at or above the saturation point (7%) gets full opacity", () => {
  assert.equal(alphaForPct(7), 1);
  assert.equal(alphaForPct(35), 1); // above saturation clamps, doesn't overshoot
});

test("alphaForPct: scales monotonically with magnitude below saturation", () => {
  assert.ok(alphaForPct(2) < alphaForPct(4));
  assert.ok(alphaForPct(4) < alphaForPct(6));
});

test("HIGH CONTRAST: a dominant wall reads dramatically bolder/brighter than a weak one", () => {
  // The whole point of the Skylit-style retune: an ~8% session-king vs a ~1% straggler must
  // NOT wash out to similar weight. Opacity ratio ≥ 4×, bead-size ratio ≥ 3×.
  assert.ok(alphaForPct(8) / alphaForPct(1) >= 4, "strong wall ≥4× the opacity of a weak one");
  assert.ok(markerSizeForPct(8) / markerSizeForPct(1) >= 3, "strong bead ≥3× the size of a weak one");
});

test("alphaForPct: treats non-finite/negative input as zero magnitude", () => {
  assert.equal(alphaForPct(NaN), 0.05);
  assert.equal(alphaForPct(-5), 0.05);
});

test("widthForPct: stays within lightweight-charts' 1-4 LineWidth union across the full range", () => {
  for (const pct of [0, 1, 5, 10, 15, 20, 50, 100]) {
    const w = widthForPct(pct);
    assert.ok(w >= 1 && w <= 4, `widthForPct(${pct}) = ${w} out of range`);
    assert.ok(Number.isInteger(w));
  }
});

test("widthForPct: a dominant wall (>= saturation) renders at max thickness; near-zero at min", () => {
  assert.equal(widthForPct(7), 4);
  assert.equal(widthForPct(0), 1);
});

test("radiusForPct: stays within the 2-6px trail-dot range and scales monotonically", () => {
  assert.equal(radiusForPct(0), 2);
  assert.equal(radiusForPct(7), 6);
  assert.ok(radiusForPct(3) < radiusForPct(6));
});

test("markerSizeForPct: per-bead sizes span the magnitude-scaled range", () => {
  assert.equal(markerSizeForPct(0), 0.3);
  assert.equal(markerSizeForPct(7), 5.5);
  assert.ok(markerSizeForPct(3) < markerSizeForPct(6));
});

test("relStrengthT: the frame's strongest wall is the full-weight reference; others scale down from it", () => {
  assert.equal(relStrengthT(40, 40), 1, "the in-frame king is always full weight");
  assert.equal(relStrengthT(0, 40), 0, "a zero-share wall is weightless");
  assert.ok(relStrengthT(20, 40) < 1 && relStrengthT(20, 40) > 0, "half-strength scales between");
  assert.ok(relStrengthT(10, 40) < relStrengthT(20, 40), "monotonic in pct for a fixed max");
  // guards
  assert.equal(relStrengthT(40, 0), 0, "maxPct <= 0 → 0 (no division blowup)");
  assert.equal(relStrengthT(NaN, 40), 0, "non-finite pct → 0");
  assert.equal(relStrengthT(-5, 40), 0, "negative pct → 0");
});

test("REGRESSION: two HIGH-concentration walls (41% vs 14%) render at clearly different sizes", () => {
  // The bug: the per-expiry chain path concentrates gamma into 20-40% strikes, so under the fixed
  // 7% absolute saturation BOTH a 41% and a 14% wall clipped to max size and looked identical
  // ("all our beads feel the same"). Absolute path collapses them; the relative path separates.
  assert.equal(
    markerSizeForPct(41),
    markerSizeForPct(14),
    "absolute path: both clip to max (this is the bug being fixed)"
  );
  const king = markerSizeForPctRel(41, 41);
  const lesser = markerSizeForPctRel(14, 41);
  assert.ok(king > lesser, "relative path: 41% is fatter than 14%");
  assert.ok(king / lesser >= 2.5, `relative path gives strong contrast (${(king / lesser).toFixed(2)}×)`);
});

test("TEMPORAL MAGNITUDE: a wall fading from peak to 1/3 strength visibly shrinks", () => {
  // A wall at 30% at 10am that fades to 10% by 2pm must produce beads that taper — the member
  // should be able to see "this wall is weakening" at a glance from the shrinking trail.
  const peak = markerSizeForPctRel(30, 30);
  const faded = markerSizeForPctRel(10, 30);
  const ratio = peak / faded;
  assert.ok(ratio >= 4, `peak-to-faded size ratio should be ≥4× (got ${ratio.toFixed(2)}×)`);
});

test("TEMPORAL MAGNITUDE: a wall growing from weak to king visibly swells", () => {
  // A wall that starts at 5% and builds to 25% should show beads getting fatter over time.
  const weak = markerSizeForPctRel(5, 25);
  const strong = markerSizeForPctRel(25, 25);
  assert.ok(strong / weak >= 6, `strong-to-weak size ratio should be ≥6× (got ${(strong / weak).toFixed(2)}×)`);
});

test("markerSizeForPctRel / alphaForPctRel: king is max weight, straggler near the floor", () => {
  // In a frame whose strongest wall is 30%, a 3% straggler must read as a thin, faint dot.
  assert.ok(markerSizeForPctRel(30, 30) >= markerSizeForPctRel(29, 30), "king at/above all others");
  assert.ok(markerSizeForPctRel(3, 30) < markerSizeForPctRel(30, 30) * 0.4, "straggler stays thin");
  assert.ok(alphaForPctRel(3, 30) < alphaForPctRel(30, 30), "straggler is fainter than the king");
  assert.equal(alphaForPctRel(0, 30), 0.14, "zero-share keeps the (brighter) faint floor, not invisible");
});

test("BRIGHTNESS RETUNE: a secondary wall reads legibly present, not a near-dead ghost", () => {
  // The "beads too light" fix: under the old 0.05 floor + squared contrast, a half-king wall sat
  // at ~0.29 alpha and read as barely there. It must now clear ~0.4 so real secondary walls are
  // clearly visible against the dark ground, while the king still tops out at full opacity.
  assert.ok(alphaForPctRel(15, 30) >= 0.4, "half-king wall is clearly visible");
  assert.equal(alphaForPctRel(30, 30), 1, "the in-frame king is still full opacity");
  assert.ok(alphaForPctRel(3, 30) >= 0.14, "even a straggler stays above the visible floor");
});

test("MODELED_ALPHA_SCALE: modeled beads render as a FAINT ghost (< observed) but not invisible", () => {
  // Faint enough to read as a ghosted secondary underlay — verified live that 0.4 was too bright
  // (a 30% wall still looked solid/full-width). Kept under half observed weight, and lifted off the
  // 0.15 floor where early-session (mostly-modeled) rails read as "too light".
  assert.ok(MODELED_ALPHA_SCALE > 0.15 && MODELED_ALPHA_SCALE <= 0.35);
  // Even the session-king strike is a quiet ghost: a full-strength modeled bead is dimmer than a
  // MID-strength observed bead, so a real recorded sample always reads as "more real."
  assert.ok(alphaForPct(100) * MODELED_ALPHA_SCALE < alphaForPct(3));
});

test("growthModulation: a wall being STACKED flares brighter + fatter than one holding steady", () => {
  const steady = growthModulation(20, 20, 40);
  const building = growthModulation(20, 8, 40); // jumped from 8% → 20% share of a 40% king
  assert.deepEqual(steady, { alphaMul: 1, sizeMul: 1, building: false, fading: false });
  assert.ok(building.building && !building.fading, "flagged building");
  assert.ok(building.alphaMul > 1 && building.sizeMul > 1, "building flares up");
});

test("growthModulation: a wall bleeding out dims + narrows and is flagged fading", () => {
  const fading = growthModulation(8, 20, 40); // dropped from 20% → 8%
  assert.ok(fading.fading && !fading.building, "flagged fading");
  assert.ok(fading.alphaMul < 1 && fading.sizeMul < 1, "fading dims down");
});

test("growthModulation: first bead (no previous) and bad input are neutral, and the flare is capped", () => {
  assert.deepEqual(growthModulation(20, null, 40), { alphaMul: 1, sizeMul: 1, building: false, fading: false });
  assert.deepEqual(growthModulation(20, undefined, 40), { alphaMul: 1, sizeMul: 1, building: false, fading: false });
  assert.deepEqual(growthModulation(20, NaN, 40), { alphaMul: 1, sizeMul: 1, building: false, fading: false });
  assert.deepEqual(growthModulation(20, 5, 0), { alphaMul: 1, sizeMul: 1, building: false, fading: false });
  // A giant one-bucket burst can't blow the bead out past the cap.
  const burst = growthModulation(40, 0, 40);
  assert.ok(burst.alphaMul <= 1.35 + 1e-9 && burst.sizeMul <= 1.28 + 1e-9, "flare is bounded");
});

test("magnitudeGlowBoost: an absolutely massive wall halos brighter than a modest one, regardless of frame", () => {
  // Magnitude is a SEPARATE channel from frame-relative strength: a 7%+ king glows ~1.7×, a tiny
  // wall ~1×, so "monster wall" reads even when a slightly bigger one shares the frame.
  assert.ok(magnitudeGlowBoost(0) === 1, "zero magnitude → neutral halo");
  assert.ok(magnitudeGlowBoost(7) > 1.6, "a saturated wall glows markedly wider");
  assert.ok(magnitudeGlowBoost(2) < magnitudeGlowBoost(6), "monotonic in absolute magnitude");
});

test("haloRingForTier: unknown/undefined tier is NEUTRAL — beads render exactly as pre-ring", () => {
  // This is the non-breaking guarantee: VEX-lens beads and any unscored rail pass no tier, so the
  // halo multiplier must be identity. If this drifts from {1,1}, every legacy bead silently changes.
  assert.deepEqual(haloRingForTier(undefined), { alphaMul: 1, sizeMul: 1 });
  assert.deepEqual(haloRingForTier(null), { alphaMul: 1, sizeMul: 1 });
});

test("haloRingForTier: firm > moderate > thin in both ring brightness and size", () => {
  const firm = haloRingForTier("firm");
  const moderate = haloRingForTier("moderate");
  const thin = haloRingForTier("thin");
  assert.ok(firm.alphaMul > moderate.alphaMul, "firm ring brighter than moderate");
  assert.ok(moderate.alphaMul > thin.alphaMul, "moderate ring brighter than thin");
  assert.ok(firm.sizeMul >= moderate.sizeMul, "firm ring at least as large as moderate");
  assert.ok(moderate.sizeMul > thin.sizeMul, "thin ring shrinks toward a bare dot");
});

test("haloRingForTier: a firm wall's halo pops above neutral; a thin wall's is suppressed", () => {
  assert.ok(haloRingForTier("firm").alphaMul > 1, "firm brightens the ring past the legacy glow");
  assert.ok(haloRingForTier("thin").alphaMul < 0.5, "thin nearly erases the ring → bead reads as a dot");
});
