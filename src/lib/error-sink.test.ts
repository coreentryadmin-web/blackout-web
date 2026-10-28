import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markDbQueryCaptured,
  wasDbQueryCaptured,
  classifyErrorSpike,
  clampErrorEventsLimit,
} from "./error-sink";

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

// Regression (2026-10-26, DISCOVERY-lane round 64): a fractional `?limit=` (e.g. `2.5`) is
// finite, so a bare `Math.min(Math.max(1, limit), 500)` let it survive untouched and reach
// `LIMIT $1` in raw SQL as a non-integer bound param -- Postgres' bigint input parser rejects
// any decimal point, turning a malformed query param into an uncaught 500 (same failure shape
// as `admin/users/route.ts`'s page/limit bug, fixed the same way: truncate before clamping).
test("clampErrorEventsLimit: truncates a fractional limit instead of passing it through", () => {
  assert.equal(clampErrorEventsLimit(2.5), 2);
  assert.equal(clampErrorEventsLimit(99.9), 99);
});

test("clampErrorEventsLimit: clamps to [1, 500] after truncation", () => {
  assert.equal(clampErrorEventsLimit(0), 1);
  assert.equal(clampErrorEventsLimit(-5), 1);
  assert.equal(clampErrorEventsLimit(-5.7), 1);
  assert.equal(clampErrorEventsLimit(10000), 500);
  assert.equal(clampErrorEventsLimit(10000.5), 500);
});

test("clampErrorEventsLimit: non-finite input (NaN/+-Infinity) falls back to the 100 default", () => {
  assert.equal(clampErrorEventsLimit(NaN), 100);
  assert.equal(clampErrorEventsLimit(Infinity), 100);
  assert.equal(clampErrorEventsLimit(-Infinity), 100);
});

test("clampErrorEventsLimit: a well-formed integer in range passes through unchanged", () => {
  assert.equal(clampErrorEventsLimit(100), 100);
  assert.equal(clampErrorEventsLimit(1), 1);
  assert.equal(clampErrorEventsLimit(500), 500);
});
