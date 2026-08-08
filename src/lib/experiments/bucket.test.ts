import assert from "node:assert/strict";
import { test } from "node:test";
import { assignVariant, bucketPercentile } from "./bucket.ts";

test("bucketPercentile is deterministic for the same subject+experiment", () => {
  const a = bucketPercentile("user_123", "pricing_guarantee_placement");
  const b = bucketPercentile("user_123", "pricing_guarantee_placement");
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 100);
});

test("bucketPercentile differs across experiments for the same subject (no cross-experiment correlation)", () => {
  const a = bucketPercentile("user_123", "experiment_a");
  const b = bucketPercentile("user_123", "experiment_b");
  // Not a hard guarantee for every possible hash, but true for this fixture — a
  // regression that made bucketPercentile ignore experimentKey would fail this.
  assert.notEqual(a, b);
});

test("assignVariant is deterministic and single-variant shortcuts without hashing", () => {
  assert.equal(assignVariant("user_1", "exp", ["only"]), "only");
  const first = assignVariant("user_42", "exp", ["control", "treatment"]);
  const second = assignVariant("user_42", "exp", ["control", "treatment"]);
  assert.equal(first, second);
});

test("assignVariant distributes roughly evenly across many subjects with default (even) weights", () => {
  const counts: Record<string, number> = { control: 0, treatment: 0 };
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const v = assignVariant(`subject_${i}`, "even_split_test", ["control", "treatment"]);
    counts[v]++;
  }
  // Loose bound (not a statistical test) — just guards against a badly broken hash
  // that dumps everything into one bucket.
  assert.ok(counts.control > N * 0.4 && counts.control < N * 0.6, `control=${counts.control}`);
  assert.ok(counts.treatment > N * 0.4 && counts.treatment < N * 0.6, `treatment=${counts.treatment}`);
});

test("assignVariant respects weights (skewed split lands mostly in the heavier variant)", () => {
  const counts: Record<string, number> = { control: 0, treatment: 0 };
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const v = assignVariant(`subject_${i}`, "weighted_test", ["control", "treatment"], [90, 10]);
    counts[v]++;
  }
  assert.ok(counts.control > N * 0.83 && counts.control < N * 0.97, `control=${counts.control}`);
  assert.ok(counts.treatment > N * 0.03 && counts.treatment < N * 0.17, `treatment=${counts.treatment}`);
});

test("assignVariant throws on empty variants, mismatched weights length, or non-positive weight sum", () => {
  assert.throws(() => assignVariant("u", "exp", []));
  assert.throws(() => assignVariant("u", "exp", ["a", "b"], [1]));
  assert.throws(() => assignVariant("u", "exp", ["a", "b"], [0, 0]));
});
