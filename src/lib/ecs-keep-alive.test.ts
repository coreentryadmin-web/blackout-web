import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The production ALB's idle timeout is 120s. Node's default keepAliveTimeout is 5s, so without an
// explicit KEEP_ALIVE_TIMEOUT the target closes sockets the ALB still believes are reusable and the
// ALB answers 502 itself. Measured 2026-08-07: HTTPCode_ELB_5XX 11-26/min with all targets healthy,
// HTTPCode_Target_5XX 1 in 35 minutes, and NOTHING in the app logs — the app never sees these, so
// neither logging nor the healthcheck can surface them. Only the deploy pipeline can guarantee it.
const wf = readFileSync(".github/workflows/ecr-push-production.yml", "utf8");
const ALB_IDLE_SECONDS = 120;

test("the production deploy sets KEEP_ALIVE_TIMEOUT on every roll", () => {
  // A hand-patched task-def revision does NOT survive: the workflow re-derives the task def from
  // whatever the service currently points at, so the next merge drops it. Rev 602 carried the fix
  // and CI's 603 removed it minutes later.
  assert.match(wf, /"name": "KEEP_ALIVE_TIMEOUT", "value": "(\d+)"/);
});

test("the configured keep-alive EXCEEDS the ALB idle timeout", () => {
  // This is the whole point. Equal is not enough — the target must outlive the ALB's window, or
  // the race simply narrows instead of closing.
  const ms = Number(wf.match(/"name": "KEEP_ALIVE_TIMEOUT", "value": "(\d+)"/)?.[1]);
  assert.ok(Number.isFinite(ms), "value must be a parseable integer (Next parses it with parseInt)");
  assert.ok(
    ms > ALB_IDLE_SECONDS * 1000,
    `keep-alive ${ms}ms must exceed the ALB idle timeout ${ALB_IDLE_SECONDS * 1000}ms`,
  );
});

test("it replaces rather than duplicates an existing entry", () => {
  // Two entries with the same name is undefined behaviour in an ECS environment array.
  assert.match(wf, /e\["name"\] != "KEEP_ALIVE_TIMEOUT"/);
});
