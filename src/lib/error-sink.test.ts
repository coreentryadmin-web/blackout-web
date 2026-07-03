import { test } from "node:test";
import assert from "node:assert/strict";
import { markDbQueryCaptured, wasDbQueryCaptured, classifyErrorSpike } from "./error-sink";

test("wasDbQueryCaptured: true for an error object marked by dbQuery, false for an unmarked one", () => {
  const captured = new Error("connection reset");
  const notCaptured = new Error("connection reset");
  markDbQueryCaptured(captured);
  assert.equal(wasDbQueryCaptured(captured), true);
  assert.equal(wasDbQueryCaptured(notCaptured), false);
});

test("wasDbQueryCaptured: non-object reasons (string, null, undefined) never throw and read false", () => {
  assert.equal(wasDbQueryCaptured("some string error"), false);
  assert.equal(wasDbQueryCaptured(null), false);
  assert.equal(wasDbQueryCaptured(undefined), false);
  markDbQueryCaptured("a string, not an object -- ignored, never throws");
  markDbQueryCaptured(null);
});

test("wasDbQueryCaptured: marking is per-object identity, not per-message -- two distinct Errors with the same message stay distinguishable", () => {
  const a = new Error("same message");
  const b = new Error("same message");
  markDbQueryCaptured(a);
  assert.equal(wasDbQueryCaptured(a), true);
  assert.equal(wasDbQueryCaptured(b), false);
});

test("classifyErrorSpike: unaffected regression check (pre-existing function)", () => {
  assert.equal(classifyErrorSpike(5, 10, 25), "none");
  assert.equal(classifyErrorSpike(15, 10, 25), "warning");
  assert.equal(classifyErrorSpike(30, 10, 25), "critical");
});
