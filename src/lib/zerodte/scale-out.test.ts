import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeScaleOut, deriveScaleOutAction, SCALE_OUT_RULES, type ScaleOutBar } from "./scale-out";

const bar = (t: number, h: number, l: number, c: number): ScaleOutBar => ({ t, h, l, c });

// ── gradeScaleOut (batch backtest parity) ──────────────────────────────────────────
test("hard stop before any 2x → realized ~0.4x (−60%)", () => {
  const bars = [bar(1, 1.1, 0.35, 0.4), bar(2, 0.5, 0.2, 0.3)]; // low 0.35 <= 0.4*entry(1)
  assert.equal(gradeScaleOut(bars, 1), SCALE_OUT_RULES.hard_stop_mult);
});

test("touches 2x then rips to 5x and holds → half locked at 2x, runner rides to close", () => {
  // entry 1. bar1 high 2.2 (scale 0.5 @ 2.0 = 1.0). bar2 high 5, close 5, no retrace to 50% of peak(5)=2.5.
  const bars = [bar(1, 2.2, 1.0, 2.0), bar(2, 5.0, 3.0, 5.0)];
  // realized = 0.5*2.0 (locked) + 0.5*5.0 (runner at close) = 1.0 + 2.5 = 3.5 → 3.5x
  assert.equal(gradeScaleOut(bars, 1), 3.5);
});

test("touches 2x, peaks at 4x, then retraces below 50% of peak → runner exits at 2x (0.5*peak)", () => {
  // entry 1. bar1 scales at 2. bar2 peak 4. bar3 low 1.9 <= 0.5*peak(4)=2.0 → runner exits at 2.0.
  const bars = [bar(1, 2.1, 1.0, 2.0), bar(2, 4.0, 3.0, 3.5), bar(3, 3.0, 1.9, 2.0)];
  // realized = 0.5*2.0 + 0.5*(4*0.5=2.0) = 1.0 + 1.0 = 2.0x
  assert.equal(gradeScaleOut(bars, 1), 2.0);
});

test("never triggers → holds to last close", () => {
  const bars = [bar(1, 1.5, 0.8, 1.2), bar(2, 1.6, 1.0, 1.3)];
  assert.equal(gradeScaleOut(bars, 1), 1.3); // full position at last close
});

test("conservative intrabar ordering: a bar that touches BOTH the hard stop and 2x counts the stop", () => {
  const bars = [bar(1, 2.5, 0.3, 1.0)]; // high 2.5 (2x) AND low 0.3 (<=0.4 stop) in one bar
  assert.equal(gradeScaleOut(bars, 1), SCALE_OUT_RULES.hard_stop_mult);
});

test("no bars / bad entry → breakeven 1.0", () => {
  assert.equal(gradeScaleOut([], 1), 1);
  assert.equal(gradeScaleOut([bar(1, 2, 1, 1.5)], 0), 1);
});

// ── deriveScaleOutAction (live state machine) ──────────────────────────────────────
test("live: pre-scale hard stop → STOP_OUT", () => {
  const a = deriveScaleOutAction({ entryPremium: 1, peakPremium: 1.2, lastMark: 0.4, scaledAlready: false });
  assert.equal(a.action, "STOP_OUT");
});

test("live: pre-scale reaches 2x → TAKE_PARTIAL", () => {
  const a = deriveScaleOutAction({ entryPremium: 1, peakPremium: 2.1, lastMark: 2.0, scaledAlready: false });
  assert.equal(a.action, "TAKE_PARTIAL");
});

test("live: pre-scale in between → HOLD", () => {
  const a = deriveScaleOutAction({ entryPremium: 1, peakPremium: 1.5, lastMark: 1.4, scaledAlready: false });
  assert.equal(a.action, "HOLD");
});

test("live: post-scale runner retraces to 50% of peak → EXIT_RUNNER", () => {
  const a = deriveScaleOutAction({ entryPremium: 1, peakPremium: 4, lastMark: 2.0, scaledAlready: true });
  assert.equal(a.action, "EXIT_RUNNER");
});

test("live: post-scale runner above trailing stop → HOLD", () => {
  const a = deriveScaleOutAction({ entryPremium: 1, peakPremium: 4, lastMark: 3.0, scaledAlready: true });
  assert.equal(a.action, "HOLD");
});

test("live: a stopped-out already-scaled position does NOT re-trigger STOP_OUT (only runner rules apply)", () => {
  // Once scaled, the hard stop no longer applies — the partial is locked; only the trail governs.
  const a = deriveScaleOutAction({ entryPremium: 1, peakPremium: 2.5, lastMark: 0.3, scaledAlready: true });
  assert.equal(a.action, "EXIT_RUNNER"); // 0.3 <= 0.5*peak(2.5)=1.25 → runner exits (not STOP_OUT)
});
