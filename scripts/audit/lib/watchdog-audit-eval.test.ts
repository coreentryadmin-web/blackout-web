import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCronWatchdogAudit } from "./watchdog-audit-eval.mjs";

test("evaluateCronWatchdogAudit: off-hours swing-discovery problem does not fail", () => {
  const v = evaluateCronWatchdogAudit(
    { problem_keys: ["swing-discovery"], rth_stale_keys: [], problems: 1 },
    { inRth: false }
  );
  assert.equal(v.shouldFail, false);
  assert.deepEqual(v.failKeys, []);
  assert.deepEqual(v.warnKeys, ["swing-discovery"]);
});

test("evaluateCronWatchdogAudit: in-RTH swing-discovery problem is warn-only (phase-anchored)", () => {
  const v = evaluateCronWatchdogAudit(
    { problem_keys: ["swing-discovery"], rth_stale_keys: [], problems: 1 },
    { inRth: true }
  );
  assert.equal(v.shouldFail, false);
  assert.deepEqual(v.failKeys, []);
  assert.deepEqual(v.warnKeys, ["swing-discovery"]);
  assert.deepEqual(v.phaseAnchoredProblems, ["swing-discovery"]);
});

test("evaluateCronWatchdogAudit: RTH stale keys fail", () => {
  const v = evaluateCronWatchdogAudit(
    { problem_keys: ["zerodte-warm"], rth_stale_keys: ["zerodte-warm"] },
    { inRth: true }
  );
  assert.equal(v.shouldFail, true);
  assert.deepEqual(v.failKeys, ["zerodte-warm"]);
});

test("evaluateCronWatchdogAudit: critical error spike fails off-hours", () => {
  const v = evaluateCronWatchdogAudit(
    { problem_keys: [], rth_stale_keys: [], error_spike: "critical" },
    { inRth: false }
  );
  assert.equal(v.shouldFail, true);
  assert.equal(v.criticalErrorSpike, true);
});
