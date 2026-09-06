import test from "node:test";
import assert from "node:assert/strict";
import { mfeCaptureOutcome } from "./mfe-capture";

test("mfeCaptureOutcome: null when peak missing or non-positive", () => {
  assert.equal(mfeCaptureOutcome(-10, null, null), null);
  assert.equal(mfeCaptureOutcome(-10, 0, null), null);
  assert.equal(mfeCaptureOutcome(-10, -5, null), null);
});

test("mfeCaptureOutcome: authoritative mfeCapturePct wins even when exit is negative", () => {
  const r = mfeCaptureOutcome(-40.8, 25.7, 12);
  assert.deepEqual(r, { kind: "capture", capturePct: 12 });
});

test("mfeCaptureOutcome: positive exit falls back to the exit/peak ratio", () => {
  const r = mfeCaptureOutcome(20, 25.7, null);
  assert.equal(r?.kind, "capture");
  assert.ok(Math.abs((r as { capturePct: number }).capturePct - (20 / 25.7) * 100) < 1e-9);
});

test("mfeCaptureOutcome: negative exit past a positive peak is a round-trip, never a negative capture", () => {
  // Reproduces the live production bug: peak +25.7%, exit -40.8% used to render "MFE capture -158.9%".
  const r = mfeCaptureOutcome(-40.8, 25.7, null);
  assert.deepEqual(r, { kind: "round_trip", peakPct: 25.7, exitPnlPct: -40.8 });
});

test("mfeCaptureOutcome: zero exit is a full give-back, not a round-trip (boundary)", () => {
  const r = mfeCaptureOutcome(0, 25.7, null);
  assert.deepEqual(r, { kind: "capture", capturePct: 0 });
});
