// Regression guard for the permanently-empty SWING board (root cause: the swing-lane crons had live
// routes + a cron-registry entry since PR-13/#1046 but were NEVER added to the EventBridge schedule
// catalog — the railway.<key>.toml files blackout-infra syncs — so the swing-discovery cron never fired
// in prod: persistSwingServingSnapshot was never called and the accumulation memory never advanced,
// leaving discoverSwingFromPersisted with nothing to serve). This test asserts BOTH swing crons are
// fully wired for scheduling (registry key -> schedule TOML -> service-map name), so the schedule can
// never silently drop again. It intentionally checks ONLY the swing keys (the full manifest alignment
// is validate-railway-cron-manifest.mjs; unrelated pre-existing drift must not fail this guard).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CRON_SERVICE_NAMES } from "./railway-cron-services.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SWING_CRONS = ["swing-discovery", "swing-active-refresh"];

const registry = readFileSync(join(ROOT, "src/lib/cron-registry.ts"), "utf8");

for (const key of SWING_CRONS) {
  test(`swing cron "${key}" is registered in cron-registry.ts`, () => {
    assert.ok(registry.includes(`key: "${key}"`), `cron-registry.ts is missing key "${key}"`);
  });

  test(`swing cron "${key}" has a railway.${key}.toml schedule catalog entry (the EventBridge source-of-truth)`, () => {
    const toml = join(ROOT, `railway.${key}.toml`);
    assert.ok(existsSync(toml), `missing railway.${key}.toml — the cron would never be scheduled/fire in prod`);
    const raw = readFileSync(toml, "utf8");
    assert.ok(
      raw.includes(`scripts/hit-cron.mjs /api/cron/${key}`),
      `railway.${key}.toml must ping /api/cron/${key} via hit-cron.mjs`,
    );
    assert.match(raw, /cronSchedule = "/, `railway.${key}.toml must declare a cronSchedule`);
  });

  test(`swing cron "${key}" has a CRON_SERVICE_NAMES entry`, () => {
    assert.ok(CRON_SERVICE_NAMES[key], `railway-cron-services.mjs is missing a service name for "${key}"`);
  });
}
