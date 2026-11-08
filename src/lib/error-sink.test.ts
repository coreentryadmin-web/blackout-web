import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markDbQueryCaptured,
  wasDbQueryCaptured,
  classifyErrorSpike,
  clampErrorEventsLimit,
  shapeAuthFailureSummary,
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

// Regression (DISCOVERY-lane round 413): `countAuthFailures` used to report
// `total_24h: rows.length` off the SAME `LIMIT 200` sample query used for
// `recent_messages`/`by_mode` -- so any 24h window with MORE than 200 real auth
// failures silently plateaued at exactly 200 forever, no matter the real magnitude.
// `shapeAuthFailureSummary` now takes the true count as its own argument, separate
// from the sample rows, so this can never regress back to `rows.length` without this
// test catching it -- the real `countAuthFailures` just has to pass a real `COUNT(*)`
// in, which it does via a second, unbounded aggregate query.
test("shapeAuthFailureSummary: total_24h reflects the REAL total, not the bounded sample's length", () => {
  const sampleRows = Array.from({ length: 200 }, (_, i) => ({
    scope: "clerk_sign_in",
    message: `failure ${i}`,
  }));
  // Real count (450) is more than double the 200-row sample this call is given --
  // exactly the brute-force-spike shape the bug understated.
  const summary = shapeAuthFailureSummary(450, sampleRows);
  assert.equal(summary.total_24h, 450);
  assert.notEqual(summary.total_24h, sampleRows.length);
});

test("shapeAuthFailureSummary: total_24h still reports exactly when the real count is below the sample cap", () => {
  const sampleRows = [
    { scope: "clerk_sign_in", message: "bad password" },
    { scope: "clerk_sign_up", message: "duplicate account" },
  ];
  const summary = shapeAuthFailureSummary(2, sampleRows);
  assert.equal(summary.total_24h, 2);
});

test("shapeAuthFailureSummary: by_mode groups by scope, defaulting a missing scope to 'unknown', and recent_messages dedupes + caps at 5", () => {
  const sampleRows = [
    { scope: "clerk_sign_in", message: "m1" },
    { scope: "clerk_sign_in", message: "m1" },
    { scope: null, message: "m2" },
    { scope: "clerk_sign_up", message: "m3" },
    { scope: "clerk_sign_up", message: "m4" },
    { scope: "clerk_sign_up", message: "m5" },
    { scope: "clerk_sign_up", message: "m6" },
  ];
  const summary = shapeAuthFailureSummary(7, sampleRows);
  assert.deepEqual(summary.by_mode, { clerk_sign_in: 2, unknown: 1, clerk_sign_up: 4 });
  assert.equal(summary.recent_messages.length, 5);
  assert.deepEqual(summary.recent_messages, ["m1", "m2", "m3", "m4", "m5"]);
});
