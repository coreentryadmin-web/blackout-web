// Regression guard for once-daily / dual-band crons that must declare schedule_cron_utc in
// cron-registry.ts so admin-cron-health suppresses off-window stale noise (ops #1331, #1550, #1983).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = readFileSync(join(ROOT, "src/lib/cron-registry.ts"), "utf8");

const SCHEDULED_CRONS = [
  "gex-eod-snapshot",
  "nighthawk-morning-confirm",
  "nighthawk-outcomes",
  "spx-signal-weight-optimize",
  "zerodte-grade",
];

for (const key of SCHEDULED_CRONS) {
  test(`scheduled cron "${key}" schedule_cron_utc matches railway.${key}.toml`, () => {
    const toml = readFileSync(join(ROOT, `railway.${key}.toml`), "utf8");
    const match = toml.match(/cronSchedule = "([^"]+)"/);
    assert.ok(match, `railway.${key}.toml must declare cronSchedule`);
    const cronExpr = match[1];
    const re = new RegExp(
      `key: "${key}"[\\s\\S]*?schedule_cron_utc:\\s*"${cronExpr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    );
    assert.match(
      registry,
      re,
      `cron-registry.ts key "${key}" must set schedule_cron_utc to match railway.${key}.toml (${cronExpr})`,
    );
  });
}
