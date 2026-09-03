import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRunnerProfile, RUNNER_TARGET_PCT_A, RUNNER_TARGET_PCT_VECTOR } from "./runner-profile";
import type { ZeroDteVectorPulse } from "./vector-crosslink";

const winnerPulse = (dir: "long" | "short"): ZeroDteVectorPulse => ({
  premium_pct: 80,
  peak_premium_pct: 90,
  action_status: "still_buy",
  is_winner: true,
  is_runner: false,
  side: dir === "long" ? "call" : "put",
  direction: dir,
  strike: 100,
  occ: "TEST",
  rank: 1,
  role: "flow-whale",
});

test("resolveRunnerProfile: A-tier + Vector winner → 400% target", () => {
  const r = resolveRunnerProfile({
    tier: "A",
    confluenceCount: 2,
    vectorPulse: winnerPulse("long"),
    direction: "long",
  });
  assert.ok(r);
  assert.equal(r!.target_pct, RUNNER_TARGET_PCT_VECTOR);
  assert.equal(r!.tag, "runner_vector");
});

test("resolveRunnerProfile: A-tier + double confluence → 300% target", () => {
  const r = resolveRunnerProfile({
    tier: "A",
    confluenceCount: 2,
    vectorPulse: null,
    direction: "long",
  });
  assert.ok(r);
  assert.equal(r!.target_pct, RUNNER_TARGET_PCT_A);
});

test("resolveRunnerProfile: C-tier with no Vector → null (standard +100%)", () => {
  assert.equal(
    resolveRunnerProfile({ tier: "C", confluenceCount: 2, vectorPulse: null, direction: "long" }),
    null
  );
});
