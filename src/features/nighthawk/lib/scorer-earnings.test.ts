// Run: node --import tsx --test src/features/nighthawk/lib/scorer-earnings.test.ts
//
// NH-R1: scorer.ts used to bake a −6 earningsPenalty directly into catalyst_score
// (part of the raw composite `score`) whenever earnings fell today/tomorrow near a
// flow print's expiry. nighthawk-tiers.ts (nhTierInputFromScored → assignNighthawkTier)
// separately reads that SAME earnings_risk boolean and applies its OWN penalty
// (W_NH_EARNINGS_RISK = −1 tier-point) plus an unconditional B-tier cap — a double
// penalty for one signal. Fix: earnings is now a flag-only signal in scorer.ts
// (earnings_risk is still set true, but no points come off the raw score); the tier
// engine remains the single channel that actually penalizes/caps for earnings risk.

import assert from "node:assert/strict";
import test from "node:test";
import { scoreCandidate } from "./scorer";
import { assignNighthawkTier, nhTierInputFromScored } from "./nighthawk-tiers";

const flows = [
  { type: "call", total_premium: 5_000_000, ticker: "TEST", expiry: "2026-08-06" },
];

test("scoreCandidate: earnings_risk no longer subtracts from catalyst_score/score (dedup)", () => {
  const clear = scoreCandidate("TEST", flows, null, {
    earnings_date: null,
    today_ymd: "2026-08-05",
    tomorrow_ymd: "2026-08-06",
  });
  const earningsRiskCandidate = scoreCandidate("TEST", flows, null, {
    earnings_date: "2026-08-06",
    today_ymd: "2026-08-05",
    tomorrow_ymd: "2026-08-06",
  });

  assert.ok(!clear.earnings_risk, "earnings-clear fixture should not carry the risk flag");
  assert.equal(earningsRiskCandidate.earnings_risk, true, "earnings_risk flag should still be set");

  // The whole point of the fix: an otherwise-identical earnings-risk fixture must
  // produce the SAME raw catalyst_score and composite score as the earnings-clear one.
  assert.equal(earningsRiskCandidate.catalyst_score, clear.catalyst_score);
  assert.equal(earningsRiskCandidate.score, clear.score);
});

test("assignNighthawkTier: earnings risk still downgrades/caps the tier (single remaining channel)", () => {
  // A mid-band score with strong signal breadth would otherwise reach "A".
  const scoredClear = { score: 45, confirming_signals: 4, earnings_risk: false };
  const scoredEarningsRisk = { score: 45, confirming_signals: 4, earnings_risk: true };

  const clearTier = assignNighthawkTier(nhTierInputFromScored(scoredClear));
  const earningsTier = assignNighthawkTier(nhTierInputFromScored(scoredEarningsRisk));

  assert.equal(clearTier.tier, "A", "sanity: strong breadth + prime band reaches A without earnings risk");
  assert.equal(earningsTier.tier, "B", "earnings risk still caps at B");
  assert.ok(
    earningsTier.factors.some((f) => f.label === "Earnings risk" && f.direction === "down"),
    "earnings risk factor should still be reported"
  );
});
