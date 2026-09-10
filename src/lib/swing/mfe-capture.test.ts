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

test("mfeCaptureOutcome: works identically for a LIVE play's current pnl, not just a closed exit — same NRG production numbers the live-giveback fix (FINDINGS 2026-09-10) checks against", () => {
  // Real committed swing position: entry 4.9, peak 11.4 (peakPct ~132.7), current pnlPct 39.8.
  // The function doesn't know or care whether the second argument is an "exit" or a "current" pnl
  // — that's the whole point of reusing it for live call sites instead of the raw peak-pnlPct
  // point-difference those sites used to do.
  const r = mfeCaptureOutcome(39.8, 132.7, null);
  assert.equal(r?.kind, "capture");
  const capture = (r as { capturePct: number }).capturePct;
  assert.ok(Math.abs(capture - (39.8 / 132.7) * 100) < 1e-9);
  // ~30.0% captured -> ~70.0% given back, not the old point-difference "93%".
  assert.ok(capture > 29 && capture < 31, `expected ~30% capture, got ${capture}`);
});
