import test from "node:test";
import assert from "node:assert/strict";

import { cronAuditWatchdogProblemKeys } from "./cron-audit-watchdog-keys.mjs";

/** Tue 2026-11-10 15:00 UTC = 10:00 AM ET — in RTH window */
const RTH_ET = new Date("2026-11-10T15:00:00.000Z");
/** Tue 2026-11-10 01:25 UTC = Mon 8:25 PM ET — post-close */
const OFF_HOURS_ET = new Date("2026-11-10T01:25:00.000Z");

test("cronAuditWatchdogProblemKeys: in RTH unions problem + rth_stale keys", () => {
  const keys = cronAuditWatchdogProblemKeys(
    { problem_keys: ["swing-discovery", "spx-evaluate"], rth_stale_keys: ["spx-evaluate"] },
    RTH_ET
  );
  assert.deepEqual(keys.sort(), ["spx-evaluate", "swing-discovery"]);
});

test("cronAuditWatchdogProblemKeys: off-hours only rth_stale_keys fail CI", () => {
  const keys = cronAuditWatchdogProblemKeys(
    { problem_keys: ["swing-discovery"], rth_stale_keys: [] },
    OFF_HOURS_ET
  );
  assert.deepEqual(keys, []);
});

test("cronAuditWatchdogProblemKeys: off-hours still pages RTH stale", () => {
  const keys = cronAuditWatchdogProblemKeys(
    { problem_keys: ["swing-discovery"], rth_stale_keys: ["heatmap-warm"] },
    OFF_HOURS_ET
  );
  assert.deepEqual(keys, ["heatmap-warm"]);
});
