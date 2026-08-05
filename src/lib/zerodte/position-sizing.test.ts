import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recommendPositionSize,
  KELLY_FRACTION,
  POSITION_SIZING_MIN_SAMPLES,
} from "./position-sizing";
import { MIN_SAMPLES } from "./feature-store";

test("reuses feature-store.ts's MIN_SAMPLES verbatim (no invented threshold)", () => {
  assert.equal(POSITION_SIZING_MIN_SAMPLES, MIN_SAMPLES);
  assert.equal(MIN_SAMPLES, 20);
});

test("quarter-Kelly fraction constant is 0.25", () => {
  assert.equal(KELLY_FRACTION, 0.25);
});

// ── Textbook Kelly math, hand-verified ────────────────────────────────────────────────
// p = 0.55, W (avgWinPct) = 1.00 (a "doubled" +100%), L (avgLossPct) = 0.50 (a -50% stop).
// f* = p/L - q/W = 0.55/0.50 - 0.45/1.00 = 1.10 - 0.45 = 0.65
// quarter-Kelly = 0.65 * 0.25 = 0.1625
test("correct Kelly math on a known textbook example (p=0.55, W=1.00, L=0.50)", () => {
  const r = recommendPositionSize({
    calibratedWinProb: 0.55,
    avgWinPct: 1.0,
    avgLossPct: 0.5,
    sampleSize: 100,
  });
  assert.equal(r.graduated, true);
  assert.ok(Math.abs(r.fullKellyFraction - 0.65) < 1e-9, `expected 0.65, got ${r.fullKellyFraction}`);
  assert.ok(
    Math.abs(r.fractionalKellyFraction - 0.1625) < 1e-9,
    `expected 0.1625, got ${r.fractionalKellyFraction}`
  );
  assert.ok(
    Math.abs(r.suggestedFractionOfBankroll - 0.1625) < 1e-9,
    `expected 0.1625, got ${r.suggestedFractionOfBankroll}`
  );
});

// A second hand-computed example with the shipped 0DTE payoff shape (+100% / -50%) at a lower,
// closer-to-breakeven win rate: p = 0.40, W = 1.00, L = 0.50.
// f* = 0.40/0.50 - 0.60/1.00 = 0.80 - 0.60 = 0.20; quarter-Kelly = 0.05
test("correct Kelly math on a second textbook example (p=0.40, W=1.00, L=0.50)", () => {
  const r = recommendPositionSize({
    calibratedWinProb: 0.4,
    avgWinPct: 1.0,
    avgLossPct: 0.5,
    sampleSize: 50,
  });
  assert.ok(Math.abs(r.fullKellyFraction - 0.2) < 1e-9, `expected 0.2, got ${r.fullKellyFraction}`);
  assert.ok(Math.abs(r.fractionalKellyFraction - 0.05) < 1e-9, `expected 0.05, got ${r.fractionalKellyFraction}`);
  assert.ok(Math.abs(r.suggestedFractionOfBankroll - 0.05) < 1e-9);
});

test("below MIN_SAMPLES: graduated=false and suggested size is 0, even though math is positive", () => {
  const r = recommendPositionSize({
    calibratedWinProb: 0.55,
    avgWinPct: 1.0,
    avgLossPct: 0.5,
    sampleSize: 19, // one under MIN_SAMPLES=20
  });
  assert.equal(r.graduated, false);
  assert.equal(r.suggestedFractionOfBankroll, 0);
  // Still computed for visibility/logging — the math itself isn't hidden, just not acted on.
  assert.ok(Math.abs(r.fullKellyFraction - 0.65) < 1e-9);
  assert.match(r.reason, /MIN_SAMPLES/);
});

test("exactly at MIN_SAMPLES clears the gate (boundary is inclusive)", () => {
  const r = recommendPositionSize({
    calibratedWinProb: 0.55,
    avgWinPct: 1.0,
    avgLossPct: 0.5,
    sampleSize: MIN_SAMPLES,
  });
  assert.equal(r.graduated, true);
  assert.ok(r.suggestedFractionOfBankroll > 0);
});

test("avgLossPct=0 is a degenerate input: never suggests sizing, never throws/NaNs", () => {
  const r = recommendPositionSize({
    calibratedWinProb: 0.6,
    avgWinPct: 1.0,
    avgLossPct: 0,
    sampleSize: 100,
  });
  assert.equal(r.graduated, false);
  assert.equal(r.suggestedFractionOfBankroll, 0);
  assert.equal(r.fullKellyFraction, 0);
  assert.ok(Number.isFinite(r.fullKellyFraction));
  assert.match(r.reason, /positive magnitudes/);
});

test("avgWinPct=0 is a degenerate input: never suggests sizing, never throws/NaNs", () => {
  const r = recommendPositionSize({
    calibratedWinProb: 0.6,
    avgWinPct: 0,
    avgLossPct: 0.5,
    sampleSize: 100,
  });
  assert.equal(r.graduated, false);
  assert.equal(r.suggestedFractionOfBankroll, 0);
  assert.ok(Number.isFinite(r.fullKellyFraction));
});

test("winProb=0: guaranteed loss, Kelly recommends 0, not negative", () => {
  const r = recommendPositionSize({
    calibratedWinProb: 0,
    avgWinPct: 1.0,
    avgLossPct: 0.5,
    sampleSize: 100,
  });
  // f* = 0/0.5 - 1/1.0 = -1 (fully negative edge)
  assert.ok(Math.abs(r.fullKellyFraction - -1) < 1e-9);
  assert.equal(r.suggestedFractionOfBankroll, 0);
  assert.equal(r.graduated, true); // sample size is fine; the EDGE is what's bad
});

test("winProb=1: guaranteed win, Kelly recommends the full non-negative fraction", () => {
  const r = recommendPositionSize({
    calibratedWinProb: 1,
    avgWinPct: 1.0,
    avgLossPct: 0.5,
    sampleSize: 100,
  });
  // f* = 1/0.5 - 0/1.0 = 2
  assert.ok(Math.abs(r.fullKellyFraction - 2) < 1e-9);
  assert.ok(Math.abs(r.fractionalKellyFraction - 0.5) < 1e-9); // 2 * 0.25
  assert.equal(r.suggestedFractionOfBankroll, r.fractionalKellyFraction);
});

test("negative-edge inputs (low win prob, poor payoff) clamp to 0, never negative", () => {
  const r = recommendPositionSize({
    calibratedWinProb: 0.2,
    avgWinPct: 0.5,
    avgLossPct: 0.5,
    sampleSize: 100,
  });
  // f* = 0.2/0.5 - 0.8/0.5 = 0.4 - 1.6 = -1.2 (deeply negative edge)
  assert.ok(r.fullKellyFraction < 0);
  assert.ok(r.fractionalKellyFraction < 0);
  assert.equal(r.suggestedFractionOfBankroll, 0); // clamped, never negative
  assert.match(r.reason, /negative-EV/);
});

test("out-of-range calibratedWinProb (e.g. 1.5 or -0.1) is treated as invalid, not clamped silently", () => {
  const tooHigh = recommendPositionSize({
    calibratedWinProb: 1.5,
    avgWinPct: 1.0,
    avgLossPct: 0.5,
    sampleSize: 100,
  });
  assert.equal(tooHigh.graduated, false);
  assert.equal(tooHigh.suggestedFractionOfBankroll, 0);
  assert.match(tooHigh.reason, /not a finite probability/);

  const tooLow = recommendPositionSize({
    calibratedWinProb: -0.1,
    avgWinPct: 1.0,
    avgLossPct: 0.5,
    sampleSize: 100,
  });
  assert.equal(tooLow.graduated, false);
  assert.equal(tooLow.suggestedFractionOfBankroll, 0);
});

test("non-finite sampleSize never graduates", () => {
  const r = recommendPositionSize({
    calibratedWinProb: 0.55,
    avgWinPct: 1.0,
    avgLossPct: 0.5,
    sampleSize: Number.NaN,
  });
  assert.equal(r.graduated, false);
  assert.equal(r.suggestedFractionOfBankroll, 0);
});
