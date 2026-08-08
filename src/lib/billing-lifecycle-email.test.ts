import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyTransition } from "./billing-lifecycle-email.ts";

test("classifyTransition: every free/community/premium pair classifies correctly", () => {
  assert.equal(classifyTransition("free", "community"), "upgrade");
  assert.equal(classifyTransition("free", "premium"), "upgrade");
  assert.equal(classifyTransition("community", "premium"), "upgrade");
  assert.equal(classifyTransition("premium", "community"), "downgrade");
  assert.equal(classifyTransition("premium", "free"), "downgrade");
  assert.equal(classifyTransition("community", "free"), "downgrade");
});

test("classifyTransition: no change in tier is not a transition", () => {
  assert.equal(classifyTransition("free", "free"), null);
  assert.equal(classifyTransition("community", "community"), null);
  assert.equal(classifyTransition("premium", "premium"), null);
});
