import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "cron-audit-query.mjs"), "utf8");

test("cron-audit-query watchdog fallback uses shared evaluateCronWatchdogAudit", () => {
  assert.match(src, /evaluateCronWatchdogAudit/);
  assert.match(src, /inRthOpenWindow/);
  assert.match(src, /verdict\.shouldFail/);
});
