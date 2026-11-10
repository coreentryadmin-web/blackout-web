import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCronWatchdogAudit } from "./watchdog-audit-eval.mjs";

test("evaluateCronWatchdogAudit: off-hours ignores post-close problem_keys", () => {
  const v = evaluateCronWatchdogAudit(
    { problem_keys: ["swing-discovery"], rth_stale_keys: [], error_spike: "none" },
    { inRth: false }
  );
  assert.equal(v.shouldFail, false);
  assert.deepEqual(v.failKeys, []);
  assert.deepEqual(v.warnKeys, ["swing-discovery"]);
});

test("evaluateCronWatchdogAudit: RTH fails on non-rth-stale problems", () => {
  const v = evaluateCronWatchdogAudit(
    { problem_keys: ["swing-discovery"], rth_stale_keys: [], error_spike: "none" },
    { inRth: true }
  );
  assert.equal(v.shouldFail, true);
});

test("evaluateCronWatchdogAudit: fails on rth_stale_keys any time", () => {
  const v = evaluateCronWatchdogAudit(
    { problem_keys: ["spx-evaluate"], rth_stale_keys: ["spx-evaluate"], error_spike: "none" },
    { inRth: false }
  );
  assert.equal(v.shouldFail, true);
  assert.deepEqual(v.failKeys, ["spx-evaluate"]);
});
