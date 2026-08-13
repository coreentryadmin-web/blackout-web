import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSetupFeatureVector } from "./feature-vector";
import { findSimilarZeroDteSetups, buildOutcomeDistribution } from "./similarity";

function row(
  ticker: string,
  session: string,
  outcome: string,
  pnl: number,
  evidenceScore = 75
) {
  const features = buildSetupFeatureVector({
    ticker,
    direction: "long",
    etMinutes: 90,
    evidenceScore,
  });
  return {
    ticker,
    session_date: session,
    feature_vector: features,
    plan_outcome: outcome,
    plan_pnl_pct: pnl,
    entry_context: null,
  };
}

describe("zerodte similarity", () => {
  it("findSimilarZeroDteSetups ranks closer feature vectors first", () => {
    const query = buildSetupFeatureVector({
      ticker: "NVDA",
      direction: "long",
      etMinutes: 90,
      evidenceScore: 78,
    });

    const corpus = [
      row("NVDA", "2026-07-01", "doubled", 100, 78),
      row("NVDA", "2026-07-02", "stopped", -50, 55),
      row("AMD", "2026-07-03", "doubled", 90, 78),
    ];

    const result = findSimilarZeroDteSetups(query, corpus, { k: 2, sameTicker: true });
    assert.equal(result.neighbors.length, 2);
    assert.equal(result.neighbors[0]!.sessionDate, "2026-07-01");
    assert.ok(result.neighbors[0]!.distance <= result.neighbors[1]!.distance);
  });

  it("buildOutcomeDistribution reports histogram not a single rate", () => {
    const dist = buildOutcomeDistribution([
      { ticker: "NVDA", sessionDate: "a", distance: 0.1, label: "win", pnlPct: 100, planOutcome: "doubled" },
      { ticker: "NVDA", sessionDate: "b", distance: 0.2, label: "win", pnlPct: 20, planOutcome: "time_stop" },
      { ticker: "NVDA", sessionDate: "c", distance: 0.3, label: "loss", pnlPct: -50, planOutcome: "stopped" },
      { ticker: "NVDA", sessionDate: "d", distance: 0.4, label: "loss", pnlPct: -10, planOutcome: "time_stop" },
      { ticker: "NVDA", sessionDate: "e", distance: 0.5, label: "win", pnlPct: 60, planOutcome: "doubled" },
    ]);
    assert.equal(dist.byOutcome.doubled, 2);
    assert.equal(dist.byOutcome.stopped, 1);
    assert.equal(dist.pnlBuckets.big_win, 2);
    assert.equal(dist.pnlBuckets.stopped_out, 1);
    assert.ok(dist.winRateWilson);
    assert.ok(dist.avgPnlPct != null);
  });
});
