import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "gha-rth-audit.mjs"), "utf8");

test("gha-rth-audit skips full-site deep audit outside RTH window", () => {
  assert.match(src, /if \(rthOpen\)/);
  assert.match(src, /Skipped — outside RTH audit window/);
});

test("gha-rth-audit does not fail cron-watchdog problems off-hours", () => {
  assert.match(src, /off-hours — not failing this run/);
});
