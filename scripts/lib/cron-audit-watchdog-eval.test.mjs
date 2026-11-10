import assert from "node:assert/strict";
import test from "node:test";

import { cronAuditFailKeys } from "./cron-audit-watchdog-eval.mjs";

test("cronAuditFailKeys: off-hours ignores non-rth problem_keys", () => {
  const keys = cronAuditFailKeys(
  { problem_keys: ["swing-discovery"], rth_stale_keys: [], error_spike: "none" },
    { inRth: false }
  );
  assert.deepEqual(keys, []);
});

test("cronAuditFailKeys: in RTH includes all problem_keys", () => {
  const keys = cronAuditFailKeys(
    { problem_keys: ["swing-discovery"], rth_stale_keys: [], error_spike: "none" },
    { inRth: true }
  );
  assert.deepEqual(keys, ["swing-discovery"]);
});

test("cronAuditFailKeys: rth_stale always fails", () => {
  const keys = cronAuditFailKeys(
    { problem_keys: [], rth_stale_keys: ["spx-evaluate"], error_spike: "none" },
    { inRth: false }
  );
  assert.deepEqual(keys, ["spx-evaluate"]);
});
