import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isVectorPickWinner,
  leaderEligibleForBoard,
  mergePeakPremiumPct,
  mergeSweepTickerUniverse,
  pickContextFromFullState,
  sortLeadersForBoard,
  VECTOR_PICK_WINNER_PCT_FLOOR,
} from "./vector-pick-sweep-core";

describe("vector-pick-sweep-core", () => {
  test("pickContextFromFullState rejects neutral play", () => {
    const ctx = pickContextFromFullState({
      spot: 100,
      play: { bias: "neutral", conviction: 0, grade: "B", style: "scalp", setup: "stand-aside", headline: "", thesis: "", targets: [], starred: [] },
    } as never);
    assert.equal(ctx, null);
  });

  test("pickContextFromFullState maps directional play", () => {
    const ctx = pickContextFromFullState({
      spot: 92,
      play: { bias: "short", conviction: 72, grade: "A", style: "scalp", setup: "momentum-short", headline: "h", thesis: "t", targets: [], starred: [] },
      gexWalls: { callWalls: [{ strike: 95 }], putWalls: [{ strike: 90 }] },
      gammaFlip: 93,
      magnet: { strike: 91.5 },
      regime: { posture: "short" },
    } as never);
    assert.ok(ctx);
    assert.equal(ctx!.play.bias, "short");
    assert.equal(ctx!.callWall, 95);
    assert.equal(ctx!.putWall, 90);
  });

  test("mergePeakPremiumPct keeps max", () => {
    assert.equal(mergePeakPremiumPct(120, 80), 120);
    assert.equal(mergePeakPremiumPct(null, 275), 275);
  });

  test("isVectorPickWinner at floor", () => {
    assert.equal(isVectorPickWinner({ premium_pct_from_entry: VECTOR_PICK_WINNER_PCT_FLOOR, peak_premium_pct: null, action_status: "caution" }), true);
    assert.equal(isVectorPickWinner({ premium_pct_from_entry: 10, peak_premium_pct: 60, action_status: "caution" }), true);
    assert.equal(isVectorPickWinner({ premium_pct_from_entry: 10, peak_premium_pct: 60, action_status: "dont_buy" }), false);
  });

  test("sortLeadersForBoard orders by best pct", () => {
    const sorted = sortLeadersForBoard([
      { premium_pct_from_entry: 20, peak_premium_pct: 30 },
      { premium_pct_from_entry: 300, peak_premium_pct: 300 },
    ]);
    assert.equal(sorted[0]!.premium_pct_from_entry, 300);
  });

  test("sortLeadersForBoard floats elite tier first", () => {
    const sorted = sortLeadersForBoard([
      { premium_pct_from_entry: 400, peak_premium_pct: 400, tier: "standard" },
      { premium_pct_from_entry: 50, peak_premium_pct: 50, tier: "elite" },
    ]);
    assert.equal(sorted[0]!.tier, "elite");
  });

  test("mergeSweepTickerUniverse hot-first dedupes", () => {
    const merged = mergeSweepTickerUniverse(["SPY", "NVDA", "INTC"], ["INTC", "SMCI"], 10);
    assert.deepEqual(merged.slice(0, 3), ["INTC", "SMCI", "SPY"]);
  });

  test("leaderEligibleForBoard includes active and high pct closed", () => {
    assert.equal(leaderEligibleForBoard({ premium_pct_from_entry: 5, peak_premium_pct: 5, action_status: "still_buy" }), true);
    assert.equal(leaderEligibleForBoard({ premium_pct_from_entry: 20, peak_premium_pct: 20, action_status: "dont_buy" }), true);
    assert.equal(leaderEligibleForBoard({ premium_pct_from_entry: 2, peak_premium_pct: 2, action_status: "dont_buy" }), false);
  });
});
