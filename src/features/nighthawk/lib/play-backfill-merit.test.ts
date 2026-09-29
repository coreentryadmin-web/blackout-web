import assert from "node:assert/strict";
import test from "node:test";
import { backfillCandidateEligible } from "./play-backfill";
import type { ScoredCandidate } from "./scorer";

const scored = (ticker: string, score: number, over: Partial<ScoredCandidate> = {}): ScoredCandidate =>
  ({
    ticker,
    direction: "long",
    score,
    conviction: "B",
    flow_score: 10,
    tech_score: 10,
    pos_score: 5,
    news_score: 0,
    smart_money_score: 0,
    fundamental_score: 0,
    short_interest_score: 0,
    wall_proximity_score: 0,
    vex_alignment_score: 0,
    catalyst_score: 0,
    confirming_signals: 3,
    earnings_risk: false,
    ...over,
  }) as ScoredCandidate;

// 2026-09-28 backfill redesign (operator-directed): backfillCandidateEligible replaces the old
// rankedCandidateMeritEligible, which required the SAME score+tier bar as the organic path and
// made backfill a no-op on any night where the whole pool scored weakly. It is now deliberately
// score/tier-blind — a very LOW score must still be eligible, because that is the entire point of
// backfill existing (reaching the configured minimum on a genuinely thin night). Structural safety
// (real contract, valid geometry, sector-cap-respecting rank order) is enforced elsewhere, by
// backfillThinEditionPlays itself — see play-backfill.test.ts.
test("backfillCandidateEligible admits a candidate regardless of how low its score is", () => {
  assert.equal(backfillCandidateEligible(scored("VERY_WEAK", 1)), true);
  assert.equal(backfillCandidateEligible(scored("WEAK", 25)), true);
  assert.equal(backfillCandidateEligible(scored("STRONG", 72)), true);
});

test("backfillCandidateEligible rejects a trading-halted candidate regardless of score", () => {
  assert.equal(backfillCandidateEligible(scored("HALTED", 90, { trading_halt: true })), false);
});

test("backfillCandidateEligible is unaffected by tier/conviction — score/tier are not checked at all", () => {
  assert.equal(backfillCandidateEligible(scored("C_TIER", 20, { conviction: "C" })), true);
});
