import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSwingConfluence, requiredSwingConfluenceCount, swingConfluenceKinds } from "./confluence";

test("requiredSwingConfluenceCount: event archetypes need 2", () => {
  assert.equal(requiredSwingConfluenceCount("EVENT_DRIVEN"), 2);
  assert.equal(requiredSwingConfluenceCount("BREAKOUT"), 3);
});

test("swingConfluenceKinds unions paths and extras", () => {
  const kinds = swingConfluenceKinds(["FLOW", "STRUCTURE"], { rsTopQuartile: true, vectorAligned: true });
  assert.deepEqual(kinds.sort(), ["FLOW", "RS", "STRUCTURE", "VECTOR"].sort());
});

test("evaluateSwingConfluence: pass at 3 kinds for BREAKOUT", () => {
  const v = evaluateSwingConfluence(["FLOW", "STRUCTURE", "POSITIONING"], "BREAKOUT");
  assert.equal(v.pass, true);
  assert.equal(v.count, 3);
});

test("evaluateSwingConfluence: fail at 2 kinds for BREAKOUT", () => {
  const v = evaluateSwingConfluence(["FLOW", "STRUCTURE"], "BREAKOUT");
  assert.equal(v.pass, false);
  assert.match(v.label, /needs 1 more/);
});

test("evaluateSwingConfluence: event archetype passes with 2 including catalyst path", () => {
  const v = evaluateSwingConfluence(["CATALYST", "FLOW"], "POST_EARNINGS_DRIFT");
  assert.equal(v.pass, true);
});

test("evaluateSwingConfluence: event archetype fails without CATALYST kind at count 2 (Q28)", () => {
  const v = evaluateSwingConfluence(["FLOW", "STRUCTURE"], "EVENT_DRIVEN");
  assert.equal(v.pass, false);
  assert.match(v.label, /CATALYST kind/);
});
