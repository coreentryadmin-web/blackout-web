import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEngineHealth, sessionBucket } from "./engine-health.ts";
import { MIN_SAMPLES, type GradedFeatureRow } from "../zerodte/feature-store.ts";
import type { SetupFeatureVector } from "../zerodte/feature-vector.ts";

function row(label: "win" | "loss", score: number, over: Partial<SetupFeatureVector> = {}, pnl: number | null = null): GradedFeatureRow {
  return {
    ticker: "X", sessionDate: "2026-07-23", label, pnlPct: pnl,
    features: { evidence_score: score, reg_structure: "TREND_UP", tod_min: 60, ...over } as unknown as SetupFeatureVector,
  };
}

test("sessionBucket maps ET-minutes to session windows", () => {
  assert.equal(sessionBucket(10), "open (9:30–10:15)");
  assert.equal(sessionBucket(200), "midday (11:00–14:30)");
  assert.equal(sessionBucket(330), "power (14:30–15:30)");
  assert.equal(sessionBucket(null), "unknown");
});

test("winner-vs-loser score separation: the score is only predictive if winners score higher", () => {
  const rows = [row("win", 85), row("win", 82), row("loss", 70), row("loss", 68)];
  const h = computeEngineHealth(rows);
  assert.equal(h.scoreSeparation.winnerMean, 83.5);
  assert.equal(h.scoreSeparation.loserMean, 69);
  assert.equal(h.scoreSeparation.edge, 14.5); // positive edge = the score separates outcomes
});

test("rates are sample-guarded — no win rate below MIN_SAMPLES", () => {
  const h = computeEngineHealth([row("win", 80), row("loss", 80), row("win", 80)]);
  assert.equal(h.overall.n, 3);
  assert.equal(h.overall.wins, 2);
  assert.equal(h.overall.winRate, null); // 3 < MIN_SAMPLES → unknown, not "67%"
});

test("score monotonicity holds when higher buckets win more (healthy)", () => {
  // Two score buckets, each above the sample floor: 85+ wins more than 65-74.
  const rows = [
    ...Array.from({ length: MIN_SAMPLES }, (_, i) => row(i < MIN_SAMPLES * 0.8 ? "win" : "loss", 88)), // ~80% at 85+
    ...Array.from({ length: MIN_SAMPLES }, (_, i) => row(i < MIN_SAMPLES * 0.4 ? "win" : "loss", 70)), // ~40% at 65-74
  ];
  const h = computeEngineHealth(rows);
  assert.equal(h.scoreMonotone, true);
  assert.equal(h.byScoreBucket["85+"]!.winRate! > h.byScoreBucket["65-74"]!.winRate!, true);
});

test("score monotonicity BREAKS when a higher bucket wins less — the drift red flag", () => {
  const rows = [
    ...Array.from({ length: MIN_SAMPLES }, (_, i) => row(i < MIN_SAMPLES * 0.3 ? "win" : "loss", 88)), // ~30% at 85+ (inverted!)
    ...Array.from({ length: MIN_SAMPLES }, (_, i) => row(i < MIN_SAMPLES * 0.7 ? "win" : "loss", 70)), // ~70% at 65-74
  ];
  const h = computeEngineHealth(rows);
  assert.equal(h.scoreMonotone, false); // higher score winning LESS → the engine's signal is drifting
});

test("cuts by regime and hour", () => {
  const rows = [
    row("win", 80, { reg_structure: "TREND_UP", tod_min: 10 }),
    row("loss", 75, { reg_structure: "RANGE", tod_min: 200 }),
  ];
  const h = computeEngineHealth(rows);
  assert.equal(h.byRegime["TREND_UP"]!.n, 1);
  assert.equal(h.byRegime["RANGE"]!.n, 1);
  assert.equal(h.byHour["open (9:30–10:15)"]!.n, 1);
  assert.equal(h.byHour["midday (11:00–14:30)"]!.n, 1);
});

test("avg P&L accumulates only rows that recorded a realized return", () => {
  const h = computeEngineHealth([row("win", 80, {}, 100), row("loss", 75, {}, -50), row("win", 80, {}, null)]);
  assert.equal(h.avgPnlPct, 25); // (100 - 50) / 2
});

test("monotonicity is null with fewer than two resolved buckets (not a false healthy)", () => {
  const h = computeEngineHealth([row("win", 80), row("loss", 80)]); // one thin bucket
  assert.equal(h.scoreMonotone, null);
});
