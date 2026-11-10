import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "cron-audit-query.mjs"), "utf8");

test("cron-audit-query watchdog fallback uses RTH-aware gating", () => {
  assert.match(src, /evaluateCronWatchdogAudit/);
  assert.match(src, /inRthOpenWindow/);
  assert.match(src, /off_hours_ignored/);
  assert.doesNotMatch(
    src,
    /\.\.\.new Set\(\[\.\.\.\(body\.problem_keys \?\? \[\]\), \.\.\.\(body\.rth_stale_keys/
  );
});
