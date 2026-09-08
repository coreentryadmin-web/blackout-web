import assert from "node:assert/strict";
import test from "node:test";
import { rankedCandidateMeritEligible } from "./play-backfill";
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

test("rankedCandidateMeritEligible rejects sub-floor scores under global-strongest defaults", () => {
  const keys = ["NH_LEGACY_GLOBAL_STRONGEST", "NH_MIN_PUBLISH_SCORE", "NH_LEGACY_MIN_TIER"] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  delete process.env.NH_LEGACY_GLOBAL_STRONGEST;
  delete process.env.NH_MIN_PUBLISH_SCORE;
  process.env.NH_LEGACY_MIN_TIER = "B";
  try {
    // Global-strongest's score floor is Math.max(MIN_PUBLISH_SCORE, NH_SCORE_PRIME_MIN) =
    // Math.max(38, 40) = 40 (edition-quality.ts's effectiveMinPublishScore — deliberately lowered
    // from the old hardcoded 55 to the measured overnight PRIME band floor, see that function's
    // own comment). 44 is now legitimately above the floor, not sub-floor — use 35 to still test
    // genuine rejection.
    assert.equal(rankedCandidateMeritEligible(scored("WEAK", 35), {}), false);
    assert.equal(rankedCandidateMeritEligible(scored("STRONG", 72), {}), true);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});
