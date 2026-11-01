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

// BUG FIX (Ask Largo standing mandate, 2026-10-15): live production repro, two REAL closed swing
// positions pulled from GET /api/market/swing/record, fetched live 2026-10-15 — ORCL positionId 9
// (entry 9.03, peakPremium 9.15, exitPnlPct 1.39) and NOW positionId 21 (entry 11.6, peakPremium
// 11.8, exitPnlPct 1.72). `exitPnlPct` is read straight off the DB; the displayed `peak` is instead
// `Math.round(((peakPremium / entry - 1) * 100) * 10) / 10` (adapters.ts's `peakDisplay`,
// 1dp-rounded) — two different derivations of "the same" percentage that can disagree by a
// fraction of a point even though peak is BY DEFINITION the position's own all-time-high sample
// (exitPnlPct is always one of the samples peak was latched from — the same watermark invariant
// play-brief.ts's own pnlForDisplay/peakForDisplay guard states explicitly for the live case).
// Before this fix, `(exitPnlPct / peak) * 100` silently produced 101.4%/106.9% here, which the
// real production play-brief rendered verbatim: "Exited +1.7% vs peak +1.7%" immediately followed
// by "**Strong discipline** — captured **+101.4%** of peak; replicate trim timing." and "MFE
// capture: **+101.4%** of peak move" — a member-facing claim that is not merely odd phrasing but
// LITERALLY IMPOSSIBLE (you cannot capture more than 100% of your own peak by construction) in the
// exact section (closedCoaching / lessonsSection) built to teach correct trade-management lessons.
// Capture can never legitimately exceed 100 — any computed excess is a rounding/precision artifact
// between the two differently-derived percentages, never a real move past the position's own
// recorded high — so it is clamped here, in the single shared function every one of the 5 call
// sites (play-brief-narrative.ts x2, play-brief-intel.ts x2, play-brief-narrative-coaching.ts)
// reads from, fixing all of them at once rather than patching each call site's rendering.
test("mfeCaptureOutcome: capture is clamped at 100% — live ORCL/NOW repro, 2026-10-15 (rounding mismatch between a 1dp-rounded peak and a raw exitPnlPct must never render as 'captured >100% of peak')", () => {
  const orcl = mfeCaptureOutcome(1.39, 1.3, null);
  assert.deepEqual(orcl, { kind: "capture", capturePct: 100 });

  const now = mfeCaptureOutcome(1.72, 1.7, null);
  assert.deepEqual(now, { kind: "capture", capturePct: 100 });

  // A genuinely large overshoot clamps the same way, not just a near-tie.
  const bigOvershoot = mfeCaptureOutcome(50, 25, null);
  assert.deepEqual(bigOvershoot, { kind: "capture", capturePct: 100 });

  // Exactly at peak is unaffected (already 100, not a new behavior) — guards against an
  // off-by-one clamp that would also disturb the boundary case.
  const exact = mfeCaptureOutcome(25.7, 25.7, null);
  assert.deepEqual(exact, { kind: "capture", capturePct: 100 });

  // Normal (non-overshoot) captures are completely untouched by the clamp.
  const normal = mfeCaptureOutcome(20, 25.7, null);
  assert.equal(normal?.kind, "capture");
  assert.ok(Math.abs((normal as { capturePct: number }).capturePct - (20 / 25.7) * 100) < 1e-9);
});
