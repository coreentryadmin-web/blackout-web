import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "cron-audit-query.mjs"), "utf8");

test("cron-audit-query uses watchdog P0/P1 verdict (not raw problem_keys)", () => {
  assert.match(src, /evaluateCronWatchdogAudit/);
  assert.match(src, /inRthOpenWindow/);
  assert.match(src, /verdict\.shouldFail/);
  assert.doesNotMatch(src, /problem_keys \?\? \[\]\)\]\)\.filter/);
});
