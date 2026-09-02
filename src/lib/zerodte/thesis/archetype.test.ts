import assert from "node:assert/strict";
import test from "node:test";
import { classifyTradeArchetype, scoreForArchetype } from "./archetype";
import type { RailScoreMap } from "./types";

test("MOMENTUM_CONTINUATION: strong MOMENTUM with no RS rail data scores via RULES, not the crude fallback (regression for the RS-tautology in scoreArchetype)", () => {
  // Same tautology as archetype-gates.ts's already-fixed momentum_rs_floor, one level up: RS is
  // permanently absent in production (scoreRsRail never fires — see archetype.ts's comment), so
  // requiring it as a core rail meant `present.length` could never reach 2 and scoreArchetype
  // always returned 0 for this archetype, regardless of how strong MOMENTUM itself was.
  const scores: RailScoreMap = { MOMENTUM: 78 };
  const match = classifyTradeArchetype(scores, null);
  assert.equal(match.archetype, "MOMENTUM_CONTINUATION");
  // A real RULES-scored confidence (avg of the single present core rail), not the fallback's
  // `scores[fallbackRail]` passthrough — both happen to read 78 here, so assert the SHAPE is
  // right by checking scoreForArchetype directly instead of relying on the coincidence.
  assert.equal(scoreForArchetype("MOMENTUM_CONTINUATION", scores, null), 78);
});

test("MOMENTUM_CONTINUATION: below its own 65 floor still scores 0 (RS removal did not weaken the bar)", () => {
  const scores: RailScoreMap = { MOMENTUM: 50 };
  assert.equal(scoreForArchetype("MOMENTUM_CONTINUATION", scores, null), 0);
});

test("MOMENTUM_CONTINUATION: a present-but-weak RS score no longer drags a strong MOMENTUM average below its floor", () => {
  // Before the fix this would have averaged (78+40)/2=59, missing the 65 floor even though
  // MOMENTUM alone clears it comfortably — RS is no longer part of the core average at all.
  const scores: RailScoreMap = { MOMENTUM: 78, RS: 40 };
  assert.equal(scoreForArchetype("MOMENTUM_CONTINUATION", scores, null), 78);
});

test("FLOW_FOLLOWING: strong FLOW with no RS data scores via RULES, not the fallback", () => {
  const scores: RailScoreMap = { FLOW: 82 };
  const match = classifyTradeArchetype(scores, null);
  assert.equal(match.archetype, "FLOW_FOLLOWING");
  assert.equal(scoreForArchetype("FLOW_FOLLOWING", scores, null), 82);
});

test("FLOW_FOLLOWING: below its own 65 floor still scores 0", () => {
  const scores: RailScoreMap = { FLOW: 40 };
  assert.equal(scoreForArchetype("FLOW_FOLLOWING", scores, null), 0);
});

test("classifyTradeArchetype: a genuinely strong MOMENTUM setup is no longer buried behind a weaker BREAKOUT read", () => {
  // Before the fix, MOMENTUM_CONTINUATION could never score nonzero via RULES (RS always
  // absent), so a setup with strong MOMENTUM but only borderline BREAKOUT evidence would be
  // misclassified as BREAKOUT purely because BREAKOUT was the only rule that could score at all.
  const scores: RailScoreMap = { MOMENTUM: 85, BREAKOUT: 61 };
  const match = classifyTradeArchetype(scores, null);
  assert.equal(match.archetype, "MOMENTUM_CONTINUATION");
  assert.equal(match.confidence, 85);
  // BREAKOUT's own two-rail average (73, averaging BREAKOUT=61 with the shared MOMENTUM=85) is
  // more than 8pts below MOMENTUM_CONTINUATION's 85 — outside the secondary-listing margin, so
  // BREAKOUT correctly does not get listed as a runner-up here.
  assert.equal(match.secondary, null);
});

test("classifyTradeArchetype: still falls back correctly when nothing clears its floor", () => {
  const scores: RailScoreMap = { MOMENTUM: 30 };
  const match = classifyTradeArchetype(scores, null);
  assert.equal(match.archetype, "MOMENTUM_CONTINUATION");
  assert.equal(match.confidence, 30);
});

test("other archetypes are untouched — BREAKOUT still requires both its core rails present", () => {
  const scores: RailScoreMap = { BREAKOUT: 80 };
  // MOMENTUM absent -> present.length (1) < Math.min(2, 2) -> BREAKOUT rule scores 0 via RULES;
  // classifyTradeArchetype falls back to the crude single-rail heuristic instead.
  assert.equal(scoreForArchetype("BREAKOUT", scores, null), 0);
  const match = classifyTradeArchetype(scores, null);
  assert.equal(match.archetype, "BREAKOUT");
  assert.equal(match.confidence, 80);
});
