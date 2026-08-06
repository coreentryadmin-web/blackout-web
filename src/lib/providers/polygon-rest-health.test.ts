import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makePolygonUpstreamHealth,
  polygonUpstreamHealth,
  resetPolygonUpstreamHealthForTest,
} from "./polygon-rest-health";

test("starts UNKNOWN with no calls recorded", () => {
  const h = makePolygonUpstreamHealth();
  const s = h.snapshot();
  assert.equal(s.state, "UNKNOWN");
  assert.equal(s.consecutive_failures, 0);
  assert.equal(s.consecutive_successes, 0);
  assert.equal(s.last_success_at, null);
  assert.equal(s.last_failure_at, null);
  assert.equal(s.total_calls, 0);
});

test("a short success streak climbs to HEALTHY", () => {
  let t = 1_000;
  const h = makePolygonUpstreamHealth();
  h.recordSuccess((t += 10));
  assert.equal(h.snapshot().state, "UNKNOWN"); // 1 success — not yet a streak
  h.recordSuccess((t += 10));
  assert.equal(h.snapshot().state, "UNKNOWN"); // 2 — still not enough
  h.recordSuccess((t += 10));
  assert.equal(h.snapshot().state, "HEALTHY"); // 3 (RECOVERY_THRESHOLD) — now healthy
  assert.equal(h.snapshot().last_success_at, t);
  assert.equal(h.snapshot().total_calls, 3);
});

test("failures escalate DEGRADED -> DOWN by consecutive count", () => {
  let t = 0;
  const h = makePolygonUpstreamHealth();
  h.recordFailure((t += 1));
  assert.equal(h.snapshot().state, "UNKNOWN"); // 1 failure — not yet degraded
  h.recordFailure((t += 1));
  assert.equal(h.snapshot().state, "DEGRADED"); // 2 (DEGRADED_THRESHOLD)
  h.recordFailure((t += 1));
  h.recordFailure((t += 1));
  assert.equal(h.snapshot().state, "DEGRADED"); // still below DOWN_THRESHOLD (5)
  h.recordFailure((t += 1));
  assert.equal(h.snapshot().state, "DOWN"); // 5 consecutive
  assert.equal(h.snapshot().consecutive_failures, 5);
  assert.equal(h.snapshot().total_failures, 5);
});

test("a success resets the failure streak and a single success after DOWN steps down to DEGRADED, not straight to HEALTHY", () => {
  let t = 0;
  const h = makePolygonUpstreamHealth();
  for (let i = 0; i < 5; i++) h.recordFailure((t += 1));
  assert.equal(h.snapshot().state, "DOWN");

  h.recordSuccess((t += 1));
  assert.equal(h.snapshot().state, "DEGRADED");
  assert.equal(h.snapshot().consecutive_failures, 0);

  h.recordSuccess((t += 1));
  h.recordSuccess((t += 1));
  assert.equal(h.snapshot().state, "HEALTHY"); // 3-success streak recovers fully
});

test("an interleaved failure resets the recovery streak (no partial credit)", () => {
  let t = 0;
  const h = makePolygonUpstreamHealth();
  h.recordSuccess((t += 1));
  h.recordSuccess((t += 1));
  h.recordFailure((t += 1)); // breaks the streak before HEALTHY
  assert.notEqual(h.snapshot().state, "HEALTHY");
  assert.equal(h.snapshot().consecutive_successes, 0);
});

test("polygonUpstreamHealth() is a process-wide singleton; reset clears it for the next test", () => {
  resetPolygonUpstreamHealthForTest();
  polygonUpstreamHealth().recordFailure();
  polygonUpstreamHealth().recordFailure();
  assert.equal(polygonUpstreamHealth().snapshot().consecutive_failures, 2);
  resetPolygonUpstreamHealthForTest();
  assert.equal(polygonUpstreamHealth().snapshot().consecutive_failures, 0);
  assert.equal(polygonUpstreamHealth().snapshot().state, "UNKNOWN");
});
