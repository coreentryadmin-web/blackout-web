import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBreakoutCandidateCap } from "./breakout-cap";

test("resolveBreakoutCandidateCap static when dynamic disabled", () => {
  const cap = resolveBreakoutCandidateCap({ qualifyingMovers: 200, breadthPctAdvancing: 0.7 });
  assert.equal(cap, 40);
});
