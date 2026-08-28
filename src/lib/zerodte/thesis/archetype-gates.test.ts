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

test("FAILED_BREAKOUT: weak REVERSAL data with no other signal still reaches PASS (failed_break_reversal_floor was dead code)", () => {
  // scoreReversalRail (rails/reversal.ts) starts at a base of 42 and only returns a hit once
  // boosts push it to >=58, so a fired REVERSAL score is always >=58 — the removed
  // `< 55` floor could never fire regardless of real signal quality.
  const result = evaluateArchetypeGates({
    archetype: "FAILED_BREAKOUT",
    rail_scores: { REVERSAL: 58 },
    structural_state: null,
  });
  assert.equal(result.verdict, "PASS");
  assert.ok(!result.blocks.includes("failed_break_reversal_floor"));
});

test("FAILED_BREAKOUT: still watches when structural_state is still TRIGGERED", () => {
  const result = evaluateArchetypeGates({
    archetype: "FAILED_BREAKOUT",
    rail_scores: { REVERSAL: 70 },
    structural_state: "TRIGGERED",
  });
  assert.equal(result.verdict, "WATCH");
  assert.ok(result.notes.includes("failed_break_still_triggered"));
});

test("VOL_EXPANSION: weak VOL data with COILED structure still reaches PASS (vol_rail_weak was dead code)", () => {
  // scoreVolRail (rails/vol.ts) starts at a base of 45 and only returns a hit once boosts
  // push it to >=52, so a fired VOL score is always >=52 — the removed `< 50` note could
  // never fire regardless of real signal quality.
  const result = evaluateArchetypeGates({
    archetype: "VOL_EXPANSION",
    rail_scores: { VOL: 52 },
    structural_state: "COILED",
  });
  assert.equal(result.verdict, "PASS");
  assert.ok(!result.notes.includes("vol_rail_weak"));
});

test("VOL_EXPANSION: still watches with no compression/trigger structural state", () => {
  const result = evaluateArchetypeGates({
    archetype: "VOL_EXPANSION",
    rail_scores: { VOL: 80 },
    structural_state: "EXTENDED",
  });
  assert.equal(result.verdict, "WATCH");
  assert.ok(result.notes.includes("vol_expansion_no_compression"));
});
