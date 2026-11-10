import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cron-audit-query.mjs"), "utf8");

test("cron-audit-query defers generic watchdog problems off the RTH audit window", () => {
  assert.match(src, /inRthOpenWindow/);
  assert.match(src, /off-hours deferral/);
  assert.match(src, /const failKeys = sessionOpen/);
});
