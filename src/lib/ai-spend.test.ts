import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCostUsd, etDayKey, SpendTracker } from "./ai-spend";

// ---- estimateCostUsd ----
test("known model: input+output priced per MTok", () => {
  const c = estimateCostUsd("claude-sonnet-4-6", { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.equal(c, 18); // 3 + 15
});

test("opus-4-8 pricing 5/25", () => {
  const c = estimateCostUsd("claude-opus-4-8", { input_tokens: 200_000, output_tokens: 40_000 });
  assert.equal(c, 2); // 0.2*5 + 0.04*25
});

test("cache read billed at 0.1x input, cache write at 1.25x input", () => {
  const c = estimateCostUsd("claude-haiku-4-5", {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
  });
  assert.ok(Math.abs((c ?? 0) - 1.35) < 1e-9);
});

test("unknown model returns null (no-op contract)", () => {
  assert.equal(estimateCostUsd("gpt-4o", { input_tokens: 100, output_tokens: 100 }), null);
});

test("missing usage returns null", () => {
  assert.equal(estimateCostUsd("claude-opus-4-8", null), null);
  assert.equal(estimateCostUsd("claude-opus-4-8", undefined), null);
});

test("missing/negative token fields coerce to 0", () => {
  assert.equal(estimateCostUsd("claude-opus-4-8", {}), 0);
  assert.equal(estimateCostUsd("claude-opus-4-8", { input_tokens: -5, output_tokens: null }), 0);
});

// ---- etDayKey ----
test("etDayKey yields YYYY-MM-DD and is DST-correct across the UTC boundary", () => {
  assert.equal(etDayKey(new Date("2026-06-22T03:00:00Z")), "2026-06-21"); // EDT UTC-4 -> 23:00 prev day
  assert.equal(etDayKey(new Date("2026-06-22T05:00:00Z")), "2026-06-22");
});

// ---- SpendTracker threshold crossing ----
test("thresholdJustCrossed fires exactly once when total crosses", () => {
  const t = new SpendTracker({ thresholdUsd: 10, estimate: () => 4 });
  const now = new Date("2026-06-22T15:00:00Z");
  assert.equal(t.record("m", {}, now).thresholdJustCrossed, false); // 4
  assert.equal(t.record("m", {}, now).thresholdJustCrossed, false); // 8
  assert.equal(t.record("m", {}, now).thresholdJustCrossed, true); // 12 -> crossed
  assert.equal(t.record("m", {}, now).thresholdJustCrossed, false); // 16 -> already alerted
});

test("unknown-model calls (estimate=null) never advance total or cross", () => {
  const t = new SpendTracker({ thresholdUsd: 1, estimate: () => null });
  const r = t.record("unknown", {}, new Date("2026-06-22T15:00:00Z"));
  assert.equal(r.added, 0);
  assert.equal(r.dayTotal, 0);
  assert.equal(r.thresholdJustCrossed, false);
});

test("ET day rollover resets total and re-arms the alert", () => {
  const t = new SpendTracker({ thresholdUsd: 10, estimate: () => 12 });
  assert.equal(t.record("m", {}, new Date("2026-06-22T15:00:00Z")).thresholdJustCrossed, true);
  const r2 = t.record("m", {}, new Date("2026-06-23T15:00:00Z"));
  assert.equal(r2.dayTotal, 12);
  assert.equal(r2.day, "2026-06-23");
  assert.equal(r2.thresholdJustCrossed, true);
});

test("threshold exactly equal counts as crossed (>=)", () => {
  const t = new SpendTracker({ thresholdUsd: 10, estimate: () => 10 });
  assert.equal(t.record("m", {}).thresholdJustCrossed, true);
});
