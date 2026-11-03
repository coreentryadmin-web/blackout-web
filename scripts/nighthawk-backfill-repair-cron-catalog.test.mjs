import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CRON_SERVICE_NAMES } from "./railway-cron-services.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "nighthawk-backfill-repair";

test("nighthawk-backfill-repair is in the EventBridge schedule catalog (CRON_SERVICE_NAMES)", () => {
  assert.ok(
    CRON_SERVICE_NAMES[KEY],
    "missing CRON_SERVICE_NAMES entry — blackout-infra cannot provision the rule"
  );
});

test("nighthawk-backfill-repair railway toml matches cron-registry schedule_cron_utc", () => {
  const toml = readFileSync(join(ROOT, `railway.${KEY}.toml`), "utf8");
  const registry = readFileSync(join(ROOT, "src/lib/cron-registry.ts"), "utf8");
  const match = toml.match(/cronSchedule = "([^"]+)"/);
  assert.ok(match, "railway toml must declare cronSchedule");
  const cronExpr = match[1];
  assert.match(
    registry,
    new RegExp(
      `key: "${KEY}"[\\s\\S]*?schedule_cron_utc:\\s*"${cronExpr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`
    )
  );
  assert.ok(
    existsSync(join(ROOT, "src/app/api/cron/nighthawk-backfill-repair/route.ts")),
    "route must exist"
  );
});
