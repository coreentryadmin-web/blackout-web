import { test } from "node:test";
import assert from "node:assert/strict";
import { flowFirstDirection, evidenceWeightedDirection } from "./merge-precedence-eval.mjs";

// Real row captured from the 2026-08-05 ledger export (blackouttrades.com /api/market/zerodte/record):
// FLOW argued short, BREAKOUT argued long with a higher score, and v2's frozen direction_owner is
// "BREAKOUT" (the evidence-weighted winner) — NOT the seating-order pick. This is the exact case the
// old (buggy) flowFirstDirection got wrong: it read direction_owner first and returned "long"/BREAKOUT
// instead of the true FLOW-first seating pick "short"/FLOW, silently making the two arms agree.
const AMD_20260803 = {
  direction_owner: "BREAKOUT",
  origin_score_map: { FLOW: 48, BREAKOUT: 54 },
  disagreeing_origins: ["FLOW"],
  merge_policy_version: "v2",
  origin_direction_map: { FLOW: "short", BREAKOUT: "long" },
};

// Second real row, same class of bug (BREAKOUT owns on score, opposite direction from FLOW).
const MU_20260729 = {
  direction_owner: "BREAKOUT",
  origin_score_map: { FLOW: 58, BREAKOUT: 79 },
  disagreeing_origins: ["FLOW"],
  merge_policy_version: "v2",
  origin_direction_map: { FLOW: "long", BREAKOUT: "short" },
};

test("flowFirstDirection: always the seating-order rail (FLOW>BREAKOUT>PIN), never direction_owner", () => {
  assert.deepEqual(flowFirstDirection(AMD_20260803), { dir: "short", owner: "FLOW" });
  assert.deepEqual(flowFirstDirection(MU_20260729), { dir: "long", owner: "FLOW" });
});

test("evidenceWeightedDirection: highest frozen score owns the direction", () => {
  assert.deepEqual(evidenceWeightedDirection(AMD_20260803), { dir: "long", owner: "BREAKOUT", score: 54 });
  assert.deepEqual(evidenceWeightedDirection(MU_20260729), { dir: "short", owner: "BREAKOUT", score: 79 });
});

test("on these real rows the two arms genuinely DISAGREE (the bug hid this)", () => {
  assert.notEqual(flowFirstDirection(AMD_20260803).dir, evidenceWeightedDirection(AMD_20260803).dir);
  assert.notEqual(flowFirstDirection(MU_20260729).dir, evidenceWeightedDirection(MU_20260729).dir);
});

test("evidenceWeightedDirection: a tie returns null (never fabricates a winner)", () => {
  const tie = { origin_score_map: { FLOW: 50, BREAKOUT: 50 }, origin_direction_map: { FLOW: "long", BREAKOUT: "short" } };
  assert.equal(evidenceWeightedDirection(tie), null);
});

test("flowFirstDirection: falls through to PIN when FLOW/BREAKOUT absent", () => {
  const pinOnly = { origin_direction_map: { PIN: "short" }, origin_score_map: { PIN: 40 } };
  assert.deepEqual(flowFirstDirection(pinOnly), { dir: "short", owner: "PIN" });
});

test("single-origin row: both arms agree on the only rail present", () => {
  const single = { direction_owner: "FLOW", origin_direction_map: { FLOW: "long" }, origin_score_map: { FLOW: 57 } };
  assert.deepEqual(flowFirstDirection(single), { dir: "long", owner: "FLOW" });
  assert.deepEqual(evidenceWeightedDirection(single), { dir: "long", owner: "FLOW", score: 57 });
});
