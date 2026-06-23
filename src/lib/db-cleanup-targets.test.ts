import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedCleanupTarget } from "./db-cleanup-targets";

test("accepts all 7 real (table,column) pairs", () => {
  assert.ok(isAllowedCleanupTarget("api_telemetry_events", "at"));
  assert.ok(isAllowedCleanupTarget("flow_alerts", "inserted_at"));
  assert.ok(isAllowedCleanupTarget("cron_job_runs", "started_at"));
  assert.ok(isAllowedCleanupTarget("spx_signal_log", "created_at"));
  assert.ok(isAllowedCleanupTarget("nighthawk_dossiers_staging", "created_at"));
  assert.ok(isAllowedCleanupTarget("nighthawk_job_log", "created_at"));
  assert.ok(isAllowedCleanupTarget("admin_audit_log", "created_at"));
});

test("rejects wrong column for a known table", () => {
  assert.equal(isAllowedCleanupTarget("api_telemetry_events", "created_at"), false);
});

test("rejects unknown table", () => {
  assert.equal(isAllowedCleanupTarget("users", "id"), false);
});

test("rejects SQL-injection attempt in table name", () => {
  assert.equal(isAllowedCleanupTarget("flow_alerts; DROP TABLE x --", "inserted_at"), false);
});

test("rejects prototype-pollution keys", () => {
  assert.equal(isAllowedCleanupTarget("constructor", "x"), false);
  assert.equal(isAllowedCleanupTarget("__proto__", "x"), false);
  assert.equal(isAllowedCleanupTarget("hasOwnProperty", "x"), false);
});
