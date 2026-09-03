import { test } from "node:test";
import assert from "node:assert/strict";
import { moneynessGateBlocks } from "./gates";
import { effectiveMaxOtmPct, vectorRunnerOtmRelax } from "./runner-profile";
import { RUNNER_SETUP_MAX_OTM_PCT, SETUP_MAX_OTM_PCT } from "./board";
import type { ZeroDteVectorPulse } from "./vector-crosslink";

test("vectorRunnerOtmRelax: aligned winner relaxes OTM", () => {
  const pulse: ZeroDteVectorPulse = {
    premium_pct: 60,
    peak_premium_pct: 70,
    action_status: "still_buy",
    is_winner: true,
    is_runner: false,
    side: "call",
    direction: "long",
    strike: 100,
    occ: "X",
    rank: 1,
    role: "flow-whale",
  };
  assert.equal(vectorRunnerOtmRelax("long", 70, pulse), true);
});

test("moneynessGateBlocks: runner cap allows 15% OTM that standard cap blocks", () => {
  const standard = moneynessGateBlocks(15, false);
  assert.equal(standard.length, 1);
  assert.equal(standard[0]!.code, "max_otm_pct");

  const runner = moneynessGateBlocks(15, false, { maxOtmPct: RUNNER_SETUP_MAX_OTM_PCT });
  assert.equal(runner.length, 0);
});

test("effectiveMaxOtmPct: runner vs standard", () => {
  assert.equal(effectiveMaxOtmPct(false), SETUP_MAX_OTM_PCT);
  assert.equal(effectiveMaxOtmPct(true), RUNNER_SETUP_MAX_OTM_PCT);
});
