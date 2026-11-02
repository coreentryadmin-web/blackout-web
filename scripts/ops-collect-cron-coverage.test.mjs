// Regression guard: ops-collect-action-items.mjs's "cron never fired" P0 detector
// (postgresItems()'s zeroRuns check) builds the Postgres job list it watches ENTIRELY from
// ALL_CRON_KEYS (= Object.keys(CRON_SERVICE_NAMES) in railway-cron-services.mjs). Any
// cron-registry.ts entry missing from that map is invisible to that detector: if its EventBridge
// schedule were ever deleted or broken (zero rows ever written to cron_job_runs), the "never
// fired" P0 alert that catches exactly that failure for every other cron would simply never fire
// for it — a monitoring blind spot that looks like a clean sweep, not an error.
//
// Found 2026-11-02: 8 registry keys (banger-discovery, banger-live-sync, darkpool-discord,
// helix-discord-digest, nighthawk-backfill-repair, thermal-discord, x-analytics,
// zerodte-skip-grade) all have live routes that call logCronRun() with that exact job_key, yet
// were absent from CRON_SERVICE_NAMES. `validate-railway-cron-manifest.mjs` already encodes a
// similar check but is not wired into `npm test` (its own CI workflow is explicitly deprecated —
// see .github/workflows/railway-cron-config-check.yml); this test keeps the one invariant that
// matters to ops-collect-action-items.mjs's live monitoring path inside the suite that actually
// runs on every PR, derived from cron-registry.ts rather than hand-listed (a hand-listed set is
// the exact defect this guards against, one level up).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ALL_CRON_KEYS } from "./railway-cron-services.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = readFileSync(join(ROOT, "src/lib/cron-registry.ts"), "utf8");
const registryKeys = [...registry.matchAll(/\n\s*key:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);

test("the scan actually found registry cron keys (a vacuous pass is not a pass)", () => {
  // Without this, a change to cron-registry.ts's shape would silently make every assertion
  // below disappear and this file would report green while checking nothing.
  assert.ok(
    registryKeys.length >= 40,
    `expected at least 40 cron-registry.ts keys, found ${registryKeys.length} — the regex parser ` +
      `has probably drifted from cron-registry.ts's shape`,
  );
});

for (const key of registryKeys) {
  test(`cron-registry.ts key "${key}" is covered by ops-collect-action-items.mjs's never-fired monitor`, () => {
    assert.ok(
      ALL_CRON_KEYS.includes(key),
      `"${key}" is registered in cron-registry.ts but missing from CRON_SERVICE_NAMES ` +
        `(railway-cron-services.mjs) — ops-collect-action-items.mjs's "cron never fired" P0 ` +
        `detector only watches ALL_CRON_KEYS, so this cron's EventBridge schedule could be ` +
        `deleted entirely and the monitor would never notice.`,
    );
  });
}
