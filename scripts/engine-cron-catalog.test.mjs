// Regression guard for 0DTE + Swing engine crons that must be in the EventBridge schedule catalog.
// Root cause history: routes landed on main but missing railway.<key>.toml / CRON_SERVICE_NAMES
// entries meant prod never fired them (swing 38/38 FailedInvocations 2026-07-29; zerodte-grade
// piggybacked warm's 10-minute throttle). This test asserts wiring for the engine-lane keys only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CRON_SERVICE_NAMES } from "./railway-cron-services.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENGINE_CRONS = [
  // zerodte-grade is scheduled again (blackout-infra now generates it), so the registry mirrors
  // its toml once more and scheduled-cron-catalog.test.mjs asserts the two agree.
  { key: "zerodte-grade", scheduleHint: "*/15", scheduleCronUtc: true },
  { key: "swing-discovery", scheduleHint: null },
  { key: "swing-active-refresh", scheduleHint: "*/15" },
];

const registry = readFileSync(join(ROOT, "src/lib/cron-registry.ts"), "utf8");

for (const { key, scheduleHint, scheduleCronUtc } of ENGINE_CRONS) {
  test(`engine cron "${key}" is registered in cron-registry.ts`, () => {
    assert.ok(registry.includes(`key: "${key}"`), `cron-registry.ts is missing key "${key}"`);
  });

  test(`engine cron "${key}" has a railway.${key}.toml schedule catalog entry`, () => {
    const toml = join(ROOT, `railway.${key}.toml`);
    assert.ok(existsSync(toml), `missing railway.${key}.toml`);
    const raw = readFileSync(toml, "utf8");
    assert.ok(
      raw.includes(`scripts/hit-cron.mjs /api/cron/${key}`),
      `railway.${key}.toml must ping /api/cron/${key}`,
    );
    assert.match(raw, /cronSchedule = "/, `railway.${key}.toml must declare cronSchedule`);
    if (scheduleHint) {
      assert.ok(raw.includes(scheduleHint), `railway.${key}.toml should use ${scheduleHint} cadence`);
    }
  });

  test(`engine cron "${key}" has a CRON_SERVICE_NAMES entry`, () => {
    assert.ok(CRON_SERVICE_NAMES[key], `railway-cron-services.mjs missing "${key}"`);
  });

  if (scheduleCronUtc) {
    test(`engine cron "${key}" schedule_cron_utc matches railway.${key}.toml`, () => {
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
}
