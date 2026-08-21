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
];

/**
 * Keys that DELIBERATELY carry no `schedule_cron_utc`, and must keep carrying none.
 *
 * `zerodte-grade` and `largo-morning-brief` used to mirror their railway toml here. Both jobs are
 * absent from blackout-infra's generated cron-jobs.json, so the mirror advertised a schedule that
 * does not exist — admin-cron-health then suppressed staleness alerts for a window in which
 * nothing was ever going to fire. The field was removed on purpose (see the long comment on each
 * registry entry).
 *
 * This assertion is INVERTED rather than deleted. Dropping the key from SCHEDULED_CRONS would
 * silently stop guarding it, and a re-added phantom schedule would sail straight back in — which
 * is the exact failure mode the removal was fixing. So: assert the field is absent AND that the
 * entry still explains why, so the reasoning cannot be quietly dropped either.
 */
const DELIBERATELY_UNSCHEDULED = ["zerodte-grade", "largo-morning-brief"];

for (const key of DELIBERATELY_UNSCHEDULED) {
  test(`cron "${key}" must NOT advertise a schedule it does not have`, () => {
    const entry = registry.match(new RegExp(`key: "${key}"[\\s\\S]*?(?=\\n    key: "|\\n\\];)`));
    assert.ok(entry, `cron-registry.ts is missing key "${key}"`);
    assert.doesNotMatch(
      entry[0],
      /schedule_cron_utc:/,
      `cron-registry.ts key "${key}" must NOT set schedule_cron_utc — the job is absent from ` +
        `blackout-infra's cron-jobs.json, so a mirrored schedule advertises a cadence nothing fires ` +
        `and suppresses the staleness alert that would reveal it. If it has since been scheduled ` +
        `for real, move it back into SCHEDULED_CRONS in the same PR.`,
    );
    assert.match(
      entry[0],
      /NOT CURRENTLY SCHEDULED/,
      `cron-registry.ts key "${key}" must keep saying it is not scheduled, so the absence reads as ` +
        `deliberate rather than as an oversight.`,
    );
  });
}

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
