import assert from "node:assert/strict";
import test from "node:test";
import { evaluateArchetypeGates } from "./archetype-gates";

test("MOMENTUM_CONTINUATION: strong MOMENTUM with no RS rail data PASSES (regression for the RS-floor tautology)", () => {
  // scoreRsRail (rails/rs.ts) only returns a hit once its own internal score already clears 55,
  // so `rail_scores.RS` in production is either >=55 or absent (never "fired but low") — and the
  // session-% inputs it needs (stock_session_pct/qqq_session_pct/sector_session_pct/d10_alpha)
  // are never populated by legacyBridgeExtrasFromSetup/thesisEvidenceToLegacyExtras, so RS is
  // permanently absent. A gate of `rail_scores.RS < 55` therefore always fired — this asserts it
  // no longer does. MOMENTUM_CONTINUATION setups with no RS entry at all must pass on MOMENTUM
  // alone once it clears its own floor.
  const result = evaluateArchetypeGates({
    archetype: "MOMENTUM_CONTINUATION",
    rail_scores: { MOMENTUM: 78 },
    structural_state: null,
  });
  assert.equal(result.verdict, "PASS");
  assert.deepEqual(result.blocks, []);
  assert.ok(!result.blocks.includes("momentum_rs_floor"));
});

test("MOMENTUM_CONTINUATION: still blocks on its own absolute MOMENTUM floor", () => {
  const result = evaluateArchetypeGates({
    archetype: "MOMENTUM_CONTINUATION",
    rail_scores: { MOMENTUM: 40 },
    structural_state: null,
  });
  assert.equal(result.verdict, "BLOCK");
  assert.deepEqual(result.blocks, ["momentum_abs_floor"]);
});

test("FLOW_FOLLOWING: strong FLOW with no RS data reaches PASS (not demoted by the same RS tautology)", () => {
  const result = evaluateArchetypeGates({
    archetype: "FLOW_FOLLOWING",
    rail_scores: { FLOW: 80 },
    structural_state: null,
    flow_class: "CAMPAIGN",
  });
  assert.equal(result.verdict, "PASS");
  assert.ok(!result.notes.includes("flow_rs_weak"));
});

test("FLOW_FOLLOWING: still blocks on its own FLOW floor", () => {
  const result = evaluateArchetypeGates({
    archetype: "FLOW_FOLLOWING",
    rail_scores: { FLOW: 40 },
    structural_state: null,
    flow_class: "CAMPAIGN",
  });
  assert.equal(result.verdict, "BLOCK");
  assert.ok(result.blocks.includes("flow_score_floor"));
});
