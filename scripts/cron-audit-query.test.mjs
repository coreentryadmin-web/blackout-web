import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluateCronWatchdogAudit } from "./audit/lib/watchdog-audit-eval.mjs";
import { inRthOpenWindow } from "./gha-et-window.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "cron-audit-query.mjs"), "utf8");

test("cron-audit-query watchdog fallback uses shared evaluateCronWatchdogAudit", () => {
  assert.match(src, /evaluateCronWatchdogAudit/);
  assert.match(src, /inRthOpenWindow/);
  assert.match(src, /verdict\.shouldFail/);
  assert.doesNotMatch(src, /body\.error_spike === "critical" \|\| problems\.length > 0/);
});

test("scheduled query at 20:25 ET does not fail on swing-discovery alone", () => {
  const now = new Date("2026-11-10T01:25:00.000Z");
  assert.equal(inRthOpenWindow(now), false);
  const v = evaluateCronWatchdogAudit(
    { problem_keys: ["swing-discovery"], rth_stale_keys: [] },
    { inRth: inRthOpenWindow(now) }
  );
  assert.equal(v.shouldFail, false);
});
