import test from "node:test";
import assert from "node:assert/strict";
import type { HorizonPlay } from "../horizon-plays";
import { enrichPlayWithVectorLeader, VECTOR_SIGNAL } from "./vector-lane-enrich";

function basePlay(score = 70): HorizonPlay {
  return {
    id: "SWING:TEST",
    ticker: "NVDA",
    direction: "LONG",
    contract: "100C",
    score,
    status: "WATCH",
    horizon: "SWING",
    reason: "flow setup",
    signalKinds: ["FLOW"],
    factors: [],
    gates: [],
  };
}

test("enrichPlayWithVectorLeader: null peakPremiumPct tags VECTOR without score bump", () => {
  const play = basePlay(72);
  const enriched = enrichPlayWithVectorLeader(play, { ticker: "NVDA", peakPremiumPct: null });
  assert.ok(enriched.signalKinds?.includes(VECTOR_SIGNAL));
  assert.equal(enriched.score, 72, "must not fabricate +3 when magnitude is absent");
});

test("enrichPlayWithVectorLeader: finite peakPremiumPct applies scaled bump", () => {
  const play = basePlay(70);
  const enriched = enrichPlayWithVectorLeader(play, { ticker: "NVDA", peakPremiumPct: 25 });
  assert.equal(enriched.score, 75, "25/5 → +5 bump");
});

test("enrichPlayWithVectorLeader: no leader is a no-op", () => {
  const play = basePlay();
  assert.deepEqual(enrichPlayWithVectorLeader(play, null), play);
});
