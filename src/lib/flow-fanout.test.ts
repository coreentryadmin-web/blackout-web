import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldFanOut } from "./flow-fanout";

// Truth table for the flow-alert fan-out predicate (imports the REAL shipped fn).
// shouldFanOut(inserted, usingDb, insertFailed) === inserted || !usingDb || insertFailed

test("new row with DB on -> publish", () => {
  assert.equal(shouldFanOut(true, true), true);
});

test("duplicate (ON CONFLICT) with DB on -> suppress (the WS+REST double-post guard)", () => {
  assert.equal(shouldFanOut(false, true), false);
});

test("DB off, treated as new -> publish", () => {
  assert.equal(shouldFanOut(true, false), true);
});

test("DB off, not inserted -> still publish (nothing to dedup against)", () => {
  assert.equal(shouldFanOut(false, false), true);
});

test("transient DB failure with DB on -> publish anyway (outage must not silence the tape)", () => {
  assert.equal(shouldFanOut(false, true, true), true);
});

test("insertFailed defaults to false -> two-arg call still dedups duplicates", () => {
  assert.equal(shouldFanOut(false, true), false);
});

test("new row never suppressed regardless of insertFailed", () => {
  assert.equal(shouldFanOut(true, true, true), true);
});
