import test from "node:test";
import assert from "node:assert/strict";
import { windowStartIso, gradeOutcome } from "./helix-signal-outcomes-job";

test("windowStartIso: buckets a timestamp to the start of its window (idempotent dedup key)", () => {
  const t1 = Date.parse("2026-08-02T14:07:00.000Z");
  const t2 = Date.parse("2026-08-02T14:12:00.000Z"); // same 15-min bucket as t1
  const t3 = Date.parse("2026-08-02T14:16:00.000Z"); // next 15-min bucket

  const bucket1 = windowStartIso(t1, 15 * 60_000);
  const bucket2 = windowStartIso(t2, 15 * 60_000);
  const bucket3 = windowStartIso(t3, 15 * 60_000);

  assert.equal(bucket1, bucket2, "same 15-min bucket must produce the same window_start");
  assert.notEqual(bucket1, bucket3, "the next bucket must produce a different window_start");
});

test("gradeOutcome: bullish signal graded 'continued' only when price actually rose", () => {
  assert.equal(gradeOutcome("bullish", 100, 102), "continued");
  assert.equal(gradeOutcome("bullish", 100, 98), "reversed");
});

test("gradeOutcome: bearish signal graded 'continued' only when price actually fell", () => {
  assert.equal(gradeOutcome("bearish", 100, 98), "continued");
  assert.equal(gradeOutcome("bearish", 100, 102), "reversed");
});

test("gradeOutcome: a move smaller than the flat threshold reads as 'flat', regardless of direction", () => {
  assert.equal(gradeOutcome("bullish", 100, 100.05), "flat");
  assert.equal(gradeOutcome("bearish", 100, 99.98), "flat");
});

test("gradeOutcome: a directionless signal (velocity spike) grades any real move as 'continued'", () => {
  assert.equal(gradeOutcome(null, 100, 103), "continued");
  assert.equal(gradeOutcome(null, 100, 97), "continued");
  assert.equal(gradeOutcome(null, 100, 100.01), "flat");
});
