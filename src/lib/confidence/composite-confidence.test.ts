import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compositeConfidence,
  dataQualityScore,
  type FeedHealth,
} from "./composite-confidence.ts";

test("all three high → HIGH tier, multiplier near the inputs", () => {
  const c = compositeConfidence({ regimeConfidence: 0.9, dataQuality: 0.9, calibrationFreshness: 0.9 });
  assert.equal(c.tier, "HIGH");
  assert.ok(c.score >= 0.85 && c.score <= 0.9); // geomean of equal values ≈ the value, ×1.0 completeness
  assert.equal(c.assessed, 3);
  assert.equal(c.sizeMultiplier, c.score);
});

test("weakest link drags the composite (geometric mean, not arithmetic)", () => {
  // Arithmetic mean of {0.95,0.95,0.3} = 0.73 (MEDIUM); geometric ≈ 0.62 — the stale input hurts more.
  const c = compositeConfidence({ regimeConfidence: 0.95, dataQuality: 0.3, calibrationFreshness: 0.95 });
  assert.ok(c.score < 0.73, `geomean should punish the weak input harder than an average, got ${c.score}`);
});

test("a low input can't hide behind two strong ones — pulls out of HIGH", () => {
  const strong = compositeConfidence({ regimeConfidence: 0.9, dataQuality: 0.9, calibrationFreshness: 0.9 });
  const dragged = compositeConfidence({ regimeConfidence: 0.9, dataQuality: 0.9, calibrationFreshness: 0.35 });
  assert.ok(dragged.score < strong.score);
  assert.notEqual(dragged.tier, "HIGH");
});

test("missing sub-signals apply a completeness discount (no free pass)", () => {
  const all = compositeConfidence({ regimeConfidence: 0.9, dataQuality: 0.9, calibrationFreshness: 0.9 });
  const two = compositeConfidence({ regimeConfidence: 0.9, dataQuality: 0.9 }); // calibration not assessed
  assert.equal(two.assessed, 2);
  assert.ok(two.score < all.score, "assessing fewer inputs must LOWER confidence, not leave it unchanged");
  assert.ok(Math.abs(two.score - 0.9 * 0.9) < 1e-6); // geomean(0.9,0.9)=0.9 × completeness 0.9 = 0.81
});

test("nothing assessed → VERY_LOW floor, never a confident default", () => {
  const c = compositeConfidence({});
  assert.equal(c.assessed, 0);
  assert.equal(c.tier, "VERY_LOW");
  assert.ok(c.score <= 0.4);
});

test("non-finite / out-of-range inputs are treated as not-assessed / clamped", () => {
  const c = compositeConfidence({ regimeConfidence: NaN, dataQuality: 1.4, calibrationFreshness: -0.2 });
  // NaN dropped; 1.4→1.0; -0.2→0.0. present=[1.0, 0.0] → geomean → ~0, ×0.9 completeness
  assert.ok(c.score < 0.1);
  assert.equal(c.assessed, 2);
});

test("dataQualityScore: weighted feed health, missing critical feed drags it down", () => {
  const feeds: FeedHealth[] = [
    { name: "flow", health: 0.98, weight: 3 },
    { name: "polygon", status: "ok", weight: 3 },
    { name: "darkpool", status: "unavailable", weight: 1 },
    { name: "news", status: "delayed", weight: 1 },
  ];
  const dq = dataQualityScore(feeds)!;
  // (3*.98 + 3*1 + 1*0 + 1*.6) / 8 = 6.54/8 = 0.8175
  assert.ok(Math.abs(dq - 0.818) < 0.002, `got ${dq}`);
  assert.ok(dq < 1 && dq > 0.7);
});

test("dataQualityScore: nothing assessable → null (stays 'not assessed', not a fake 1.0)", () => {
  assert.equal(dataQualityScore([]), null);
  assert.equal(dataQualityScore([{ name: "x" }]), null); // no status, no health
});

test("end-to-end: dataQuality feeds the composite", () => {
  const dq = dataQualityScore([{ name: "flow", status: "ok" }, { name: "news", status: "stale" }]);
  const c = compositeConfidence({ regimeConfidence: 0.8, dataQuality: dq, calibrationFreshness: 0.7 });
  assert.equal(c.components.dataQuality, dq);
  assert.ok(c.score > 0 && c.score < 1);
});
