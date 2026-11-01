import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichPlayWithVectorLeader, enrichSwingPlaysWithVectorLeaders } from "./vector-lane-enrich.ts";
import type { HorizonPlay } from "../horizon-plays.ts";

function basePlay(overrides: Partial<HorizonPlay> = {}): HorizonPlay {
  return {
    ticker: "NVDA",
    direction: "LONG",
    horizon: "SWING",
    score: 70,
    status: "COMMIT",
    scoreFloor: 60,
    reason: "swing thesis",
    contract: { strike: 150, expiry: "2026-09-18", right: "C", dte: 6, mid: 5.0 },
    factors: [{ label: "Structure", points: 40 }, { label: "Rel. strength", points: 30 }],
    ...overrides,
  };
}

// FINDINGS 2026-09-12 (same root cause as banger-lane-merge.ts's factors fix): `score` used to be
// bumped for Vector corroboration with no matching entry added to `factors`, so a Vector-
// corroborated play's own "Why this play was picked" / Ask Largo "Score pillars" panel summed to
// less than the SCORE shown right next to it, with no line explaining the gap.
test("enrichPlayWithVectorLeader: factors sum to score exactly after the bump", () => {
  const play = basePlay();
  const enriched = enrichPlayWithVectorLeader(play, { ticker: "NVDA", peakPremiumPct: 40 });
  const factorSum = (enriched.factors ?? []).reduce((n, f) => n + f.points, 0);
  assert.equal(factorSum, enriched.score);
  // bump = min(8, round(40/5)) = 8, so score should have moved from 70 to 78.
  assert.equal(enriched.score, 78);
});

test("enrichPlayWithVectorLeader: default +3 bump (no peakPremiumPct) is also recorded in factors", () => {
  const play = basePlay();
  const enriched = enrichPlayWithVectorLeader(play, { ticker: "NVDA" });
  const factorSum = (enriched.factors ?? []).reduce((n, f) => n + f.points, 0);
  assert.equal(factorSum, enriched.score);
  assert.equal(enriched.score, 73);
});

// The 99 ceiling clamp means the REAL score delta can be smaller than the raw bump — crediting the
// full raw bump to `factors` in that case would overstate it past what `score` actually moved.
test("enrichPlayWithVectorLeader: near the 99 ceiling, only the ACTUALLY-applied delta is recorded", () => {
  const play = basePlay({
    score: 95,
    factors: [{ label: "Structure", points: 55 }, { label: "Rel. strength", points: 40 }],
  });
  const enriched = enrichPlayWithVectorLeader(play, { ticker: "NVDA", peakPremiumPct: 40 }); // raw bump would be 8
  assert.equal(enriched.score, 99);
  const factorSum = (enriched.factors ?? []).reduce((n, f) => n + f.points, 0);
  assert.equal(factorSum, 99);
});

test("enrichPlayWithVectorLeader: already at the 99 ceiling adds no zero-point factor", () => {
  const play = basePlay({ score: 99, factors: [{ label: "Structure", points: 99 }] });
  const enriched = enrichPlayWithVectorLeader(play, { ticker: "NVDA", peakPremiumPct: 40 });
  assert.equal(enriched.score, 99);
  assert.equal(enriched.factors?.length, 1);
  const factorSum = (enriched.factors ?? []).reduce((n, f) => n + f.points, 0);
  assert.equal(factorSum, 99);
});

test("enrichSwingPlaysWithVectorLeaders: no leader for the ticker leaves the play untouched", () => {
  const play = basePlay();
  const [out] = enrichSwingPlaysWithVectorLeaders([play], [{ ticker: "OTHER", peakPremiumPct: 40 }]);
  assert.equal(out, play);
});

// Live gap found 2026-09-22: peakPremiumPct is a genuine running max (GREATEST across every sweep
// tick), so a negative value means the Vector pick has NEVER been profitable — a losing signal, not
// corroboration. Unguarded, this used to compute a negative rawBump, silently reducing score with
// no factor line (appliedBump<0 skips the factor append), while still tagging VECTOR + "Vector
// corroboration" as if it were supporting evidence.
test("enrichPlayWithVectorLeader: a confirmed-negative peakPremiumPct (a losing Vector pick) gets no enrichment at all", () => {
  const play = basePlay();
  const enriched = enrichPlayWithVectorLeader(play, { ticker: "NVDA", peakPremiumPct: -20 });
  assert.equal(enriched, play, "play must be returned completely untouched, not silently penalized");
  assert.equal(enriched.score, 70, "score must not be reduced by an undisclosed 'corroboration' bump");
  assert.ok(!(enriched.signalKinds ?? []).includes("VECTOR"), "a losing pick must not be tagged as a corroborating VECTOR signal");
  assert.ok(!enriched.reason.includes("Vector"), "reason must not claim corroboration from a losing pick");
});

test("enrichPlayWithVectorLeader: a peakPremiumPct of exactly 0 still gets the normal small-bump treatment (boundary, not negative)", () => {
  const play = basePlay();
  const enriched = enrichPlayWithVectorLeader(play, { ticker: "NVDA", peakPremiumPct: 0 });
  // rawBump = min(8, round(0/5)) = 0 -> appliedBump = 0 -> no factor added, but this is the existing
  // zero-bump path (already covered by the ceiling test above for a different reason), not the
  // negative-peak skip -- score/signalKinds/reason still update since the leader is genuine, just
  // with a zero-point nudge.
  assert.equal(enriched.score, 70);
  assert.ok((enriched.signalKinds ?? []).includes("VECTOR"));
});
