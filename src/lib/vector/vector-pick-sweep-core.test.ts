import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isVectorPickClosureWinner,
  isVectorPickRunner,
  isVectorPickWinner,
  leaderEligibleForBoard,
  VECTOR_PICK_LEADER_PCT_FLOOR,
  mergePeakPremiumPct,
  mergeSweepTickerUniverse,
  pickContextFromFullState,
  resolveVectorPickEntryMid,
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

  // REGRESSION (2026-08-29 audit finding): a committed `pivot` play's raw card bias stays
  // "neutral" by design, so the old raw-field check silently treated every committed pivot
  // ticker as "no directional play" — never even reaching ranking. Same root cause as the
  // already-fixed contract-picks/live/route.ts bug, in this server sweep's own call site.
  test("pickContextFromFullState re-derives a COMMITTED pivot play's effective bias instead of rejecting it as neutral", () => {
    const ctx = pickContextFromFullState({
      spot: 7517, // 0.3% above the flip -- effectivePickBias commits "long"
      play: { bias: "neutral", conviction: 70, grade: "A", style: "scalp", setup: "pivot", headline: "h", thesis: "t", targets: [], starred: [] },
      gammaFlip: 7495.51,
    } as never);
    assert.ok(ctx, "a committed pivot play must produce a pick context, not null");
    assert.equal(ctx!.play.bias, "long", "ctx.play.bias must carry the COMMITTED direction, not the raw neutral card bias");
  });

  test("pickContextFromFullState still rejects an UNCOMMITTED pivot play (spot sitting on the flip)", () => {
    const ctx = pickContextFromFullState({
      spot: 7495.51, // exactly on the flip -- no commitment yet
      play: { bias: "neutral", conviction: 70, grade: "A", style: "scalp", setup: "pivot", headline: "h", thesis: "t", targets: [], starred: [] },
      gammaFlip: 7495.51,
    } as never);
    assert.equal(ctx, null);
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

  test("isVectorPickClosureWinner counts archived +50% runners", () => {
    assert.equal(isVectorPickClosureWinner({ premium_pct_from_entry: VECTOR_PICK_WINNER_PCT_FLOOR }), true);
    assert.equal(isVectorPickClosureWinner({ premium_pct_from_entry: 275 }), true);
    assert.equal(isVectorPickClosureWinner({ premium_pct_from_entry: 49.9 }), false);
    assert.equal(isVectorPickClosureWinner({ premium_pct_from_entry: null }), false);
  });

  test("closure winner not blocked by stale live leader on same OCC", () => {
    const occ = "O:MSFT260828P00505000";
    const leaders = [
      {
        contract: { occ },
        is_winner: false,
        premium_pct_from_entry: -50,
        peak_premium_pct: -50,
      },
    ];
    const leaderWinnerOccs = new Set(
      leaders.filter((r) => r.is_winner).map((r) => r.contract.occ.trim().toUpperCase())
    );
    const closure = { occ, premium_pct_from_entry: 50 };
    assert.equal(isVectorPickClosureWinner(closure), true);
    assert.equal(leaderWinnerOccs.has(occ), false);
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

  test("isVectorPickRunner is +15%…+49% band excluding winners", () => {
    assert.equal(
      isVectorPickRunner({
        premium_pct_from_entry: VECTOR_PICK_LEADER_PCT_FLOOR,
        peak_premium_pct: null,
        action_status: "caution",
      }),
      true
    );
    assert.equal(
      isVectorPickRunner({
        premium_pct_from_entry: VECTOR_PICK_WINNER_PCT_FLOOR - 0.1,
        peak_premium_pct: null,
        action_status: "caution",
      }),
      true
    );
    assert.equal(
      isVectorPickRunner({
        premium_pct_from_entry: VECTOR_PICK_WINNER_PCT_FLOOR,
        peak_premium_pct: null,
        action_status: "caution",
      }),
      false
    );
    assert.equal(
      isVectorPickRunner({
        premium_pct_from_entry: 10,
        peak_premium_pct: 40,
        action_status: "dont_buy",
      }),
      true
    );
  });
});

describe("resolveVectorPickEntryMid", () => {
  test("an already-tracked leader uses its FROZEN entry_mid, never the current pass's re-derived pick premium", () => {
    // Live 2026-08-31: QQQ's frozen entry_mid was $1.94, but the sweep pass that produced the
    // -2.11% read had re-ranked the pick at $1.42 — the frozen value must win.
    assert.equal(resolveVectorPickEntryMid(1.94, 1.42, 1.42), 1.94);
  });

  test("a brand-new leader (no frozen row yet) falls back to the pick's own entryMid, then premium", () => {
    assert.equal(resolveVectorPickEntryMid(null, 2.5, 2.4), 2.5);
    assert.equal(resolveVectorPickEntryMid(null, null, 2.4), 2.4);
    assert.equal(resolveVectorPickEntryMid(null, undefined, undefined), null);
  });

  test("a frozen entry_mid of exactly 0 is still honored, not treated as absent", () => {
    assert.equal(resolveVectorPickEntryMid(0, 2.5, 2.4), 0);
  });
});
