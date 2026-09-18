// Regression: `logCronRun`'s message derivation must not discard a cron's PLURAL `errors: []`
// array just because there's no singular `error`/`reason` string.
//
// Root-caused 2026-09-12: db-cleanup's own failure payload is `{ ok: false, errors:
// [{table, error}] }` — no singular `error`/`reason` field at all — so the "Cron failure:
// db-cleanup" Discord alert that fired for a real `vector_wall_history` deadlock rendered as the
// bare, contentless word "failed". Diagnosing it required going straight to CloudWatch instead of
// the alert itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCronRunStatus } from "./cron-run";

test("a plain ok:true run derives status=ok, message=ok", () => {
  const { status, message } = deriveCronRunStatus({ ok: true });
  assert.equal(status, "ok");
  assert.equal(message, "ok");
});

test("skipped:true wins over ok, regardless of what else is set", () => {
  const { status, message } = deriveCronRunStatus({ ok: false, skipped: true, reason: "outside window" });
  assert.equal(status, "skipped");
  assert.equal(message, "outside window");
});

test("a singular `error` string is used as-is when present (pre-existing behavior, unchanged)", () => {
  const { status, message } = deriveCronRunStatus({ ok: false, error: "boom" });
  assert.equal(status, "failed");
  assert.equal(message, "boom");
});

test("a singular `reason` string is used as-is when present (pre-existing behavior, unchanged)", () => {
  const { status, message } = deriveCronRunStatus({ ok: false, reason: "no data" });
  assert.equal(status, "failed");
  assert.equal(message, "no data");
});

// THE BUG: db-cleanup's actual failure shape has no `error`/`reason` at all.
test("REGRESSION: ok:false with ONLY a plural `errors` array (db-cleanup's actual shape) must not collapse to the bare word 'failed'", () => {
  const { status, message } = deriveCronRunStatus({
    ok: false,
    errors: [{ table: "vector_wall_history", error: "deadlock detected" }],
  });
  assert.equal(status, "failed");
  assert.equal(message, "vector_wall_history: deadlock detected");
});

test("multiple plural errors are joined, each carrying its own table", () => {
  const { message } = deriveCronRunStatus({
    ok: false,
    errors: [
      { table: "flow_alerts", error: "deadlock detected" },
      { table: "cron_job_runs", error: "connection terminated" },
    ],
  });
  assert.equal(message, "flow_alerts: deadlock detected; cron_job_runs: connection terminated");
});

test("a long plural-errors array is truncated with a '+N more' suffix, never silently dropped or unbounded", () => {
  const errors = Array.from({ length: 8 }, (_, i) => ({ table: `t${i}`, error: "e" }));
  const { message } = deriveCronRunStatus({ ok: false, errors });
  assert.equal(message, "t0: e; t1: e; t2: e; t3: e; t4: e (+3 more)");
});

test("plain string entries in the errors array are used verbatim", () => {
  const { message } = deriveCronRunStatus({ ok: false, errors: ["connection reset"] });
  assert.equal(message, "connection reset");
});

test("an errors entry missing `table` still surfaces its `error` text instead of falling through to 'failed'", () => {
  const { message } = deriveCronRunStatus({ ok: false, errors: [{ error: "timeout" }] });
  assert.equal(message, "timeout");
});

test("a singular `error` still takes precedence over a plural `errors` array when both are present", () => {
  const { message } = deriveCronRunStatus({
    ok: false,
    error: "top-level summary",
    errors: [{ table: "x", error: "detail" }],
  });
  assert.equal(message, "top-level summary");
});

test("an empty `errors` array falls through to the bare 'failed', same as no errors field at all", () => {
  const { status, message } = deriveCronRunStatus({ ok: false, errors: [] });
  assert.equal(status, "failed");
  assert.equal(message, "failed");
});

test("ok:false with nothing else at all still degrades to the bare word 'failed' (no crash, no undefined)", () => {
  const { status, message } = deriveCronRunStatus({ ok: false });
  assert.equal(status, "failed");
  assert.equal(message, "failed");
});

test("message is capped at 500 chars even when built from a long plural-errors summary", () => {
  const errors = [{ table: "t", error: "x".repeat(600) }];
  const { message } = deriveCronRunStatus({ ok: false, errors });
  assert.ok(message.length <= 500);
});
