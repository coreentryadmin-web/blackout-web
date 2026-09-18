import test from "node:test";
import assert from "node:assert/strict";
import { shrinkRatePct, pooledRatePct } from "./rate-shrinkage";

// ── shrinkRatePct ─────────────────────────────────────────────────────────────────

test("shrinkRatePct: n=0 returns the pool rate exactly -- no real information, no opinion of its own", () => {
  assert.equal(shrinkRatePct(0, 100, 40, 4), 40);
});

test("shrinkRatePct: negative or non-finite n also falls back to the pool rate, never NaN/negative", () => {
  assert.equal(shrinkRatePct(-1, 100, 40, 4), 40);
  assert.equal(shrinkRatePct(Number.NaN, 100, 40, 4), 40);
});

test("shrinkRatePct: priorStrength<=0 is an explicit opt-out -- returns the observed rate unshrunk", () => {
  assert.equal(shrinkRatePct(3, 100, 40, 0), 100);
  assert.equal(shrinkRatePct(3, 100, 40, -1), 100);
});

test("shrinkRatePct: a THIN sample (n << priorStrength) pulls heavily toward the pool -- the exact trap this exists to prevent", () => {
  // n=2 100%-wrongly at priorStrength=8, pool=30% -- should NOT report anywhere near 100%.
  const shrunk = shrinkRatePct(2, 100, 30, 8);
  assert.ok(shrunk < 50, `expected a heavily-pulled-toward-pool value, got ${shrunk}`);
  assert.equal(shrunk, Math.round(((2 * 100 + 8 * 30) / 10) * 10) / 10);
});

test("shrinkRatePct: a LARGE sample (n >> priorStrength) is allowed to actually move the number", () => {
  // n=200 at 80% observed, priorStrength=4, pool=30% -- should land very close to 80, not 30.
  const shrunk = shrinkRatePct(200, 80, 30, 4);
  assert.ok(shrunk > 75, `expected the real signal to dominate at large n, got ${shrunk}`);
});

test("shrinkRatePct: n exactly equal to priorStrength is the 50/50 midpoint between observed and pool", () => {
  assert.equal(shrinkRatePct(5, 100, 0, 5), 50);
});

test("shrinkRatePct: observed === pool returns that same value regardless of n (nothing to shrink toward a different value)", () => {
  assert.equal(shrinkRatePct(1, 42, 42, 4), 42);
  assert.equal(shrinkRatePct(500, 42, 42, 4), 42);
});

// ── pooledRatePct ─────────────────────────────────────────────────────────────────

test("pooledRatePct: all-empty buckets -> null, never a fabricated 0 or 50", () => {
  assert.equal(pooledRatePct([]), null);
  assert.equal(pooledRatePct([{ n: 0, ratePct: 100 }, { n: 0, ratePct: 0 }]), null);
});

test("pooledRatePct: a single bucket returns its own rate", () => {
  assert.equal(pooledRatePct([{ n: 10, ratePct: 66.7 }]), 66.7);
});

test("pooledRatePct: weights by n -- a large bucket dominates a small one, not a naive average of rates", () => {
  // naive average of (100, 0) would be 50; n-weighted should be close to 0 since the n=1000 bucket dominates.
  const pooled = pooledRatePct([
    { n: 1000, ratePct: 0 },
    { n: 1, ratePct: 100 },
  ]);
  assert.ok(pooled !== null && pooled < 5, `expected n-weighting to dominate toward 0, got ${pooled}`);
});

test("pooledRatePct: zero-n buckets are skipped, not counted as zero-weight-zero-rate noise", () => {
  const pooled = pooledRatePct([
    { n: 0, ratePct: 999 }, // garbage rate on an empty bucket must not corrupt the pool
    { n: 10, ratePct: 50 },
  ]);
  assert.equal(pooled, 50);
});
