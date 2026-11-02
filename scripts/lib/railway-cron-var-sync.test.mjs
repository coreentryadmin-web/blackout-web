import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCronVarSyncPlan } from "./railway-cron-var-sync.mjs";

const CRON_SECRET = "s3cr3t";
const INTERNAL_BASE = "http://blackout-web.railway.internal:8080";

test("counts an already-in-sync service toward syncedCount with no updates", () => {
  const entries = [
    {
      key: "gex-alerts",
      serviceName: "GEX-Alerts",
      serviceExists: true,
      vars: { CRON_SECRET, CRON_TARGET_BASE_URL: INTERNAL_BASE },
    },
  ];
  const { syncedCount, updates } = computeCronVarSyncPlan(entries, CRON_SECRET, INTERNAL_BASE);
  assert.equal(syncedCount, 1);
  assert.deepEqual(updates, []);
});

test("counts a service that NEEDED an update toward syncedCount once its update is planned — this is the bug", () => {
  // railway-audit-apply.mjs's whole point in this step is to bring every cron
  // trigger INTO sync. A service that started out of sync and gets a planned
  // update applied by the caller is in sync by the time the run finishes —
  // the old inline loop undercounted this case by gating the increment on the
  // PRE-sync `synced` flag instead of on "was a plan produced for it".
  const entries = [
    {
      key: "zerodte-warm",
      serviceName: "ZeroDTE-Warm-Cron",
      serviceExists: true,
      vars: { CRON_SECRET: "stale-secret", CRON_TARGET_BASE_URL: INTERNAL_BASE },
    },
  ];
  const { syncedCount, updates } = computeCronVarSyncPlan(entries, CRON_SECRET, INTERNAL_BASE);
  assert.equal(syncedCount, 1, "service with a planned CRON_SECRET update must still count as synced");
  assert.deepEqual(updates, [
    { key: "zerodte-warm", serviceName: "ZeroDTE-Warm-Cron", variable: "CRON_SECRET", value: CRON_SECRET },
  ]);
});

test("plans both variable updates for a service missing both, and still counts it as synced", () => {
  const entries = [
    {
      key: "flow-ingest",
      serviceName: "Flow-Ingest-Cron",
      serviceExists: true,
      vars: {},
    },
  ];
  const { syncedCount, updates } = computeCronVarSyncPlan(entries, CRON_SECRET, INTERNAL_BASE);
  assert.equal(syncedCount, 1);
  assert.deepEqual(updates, [
    { key: "flow-ingest", serviceName: "Flow-Ingest-Cron", variable: "CRON_SECRET", value: CRON_SECRET },
    {
      key: "flow-ingest",
      serviceName: "Flow-Ingest-Cron",
      variable: "CRON_TARGET_BASE_URL",
      value: INTERNAL_BASE,
    },
  ]);
});

test("a service whose Railway trigger does not exist yet is excluded from syncedCount and from updates", () => {
  const entries = [
    { key: "helix-signal-outcomes", serviceName: "Helix-Signal-Outcomes", serviceExists: false, vars: {} },
  ];
  const { syncedCount, updates, missing } = computeCronVarSyncPlan(entries, CRON_SECRET, INTERNAL_BASE);
  assert.equal(syncedCount, 0);
  assert.deepEqual(updates, []);
  assert.deepEqual(missing, ["helix-signal-outcomes"]);
});

test("mixed batch: syncedCount reflects every EXISTING service, in-sync or not — reproduces the real undercount", () => {
  const entries = [
    {
      key: "gex-alerts",
      serviceName: "GEX-Alerts",
      serviceExists: true,
      vars: { CRON_SECRET, CRON_TARGET_BASE_URL: INTERNAL_BASE },
    },
    {
      key: "flow-ingest",
      serviceName: "Flow-Ingest-Cron",
      serviceExists: true,
      vars: { CRON_SECRET: "stale", CRON_TARGET_BASE_URL: "stale-base" },
    },
    {
      key: "data-correctness",
      serviceName: "Data-Correctness-Cron",
      serviceExists: true,
      vars: { CRON_SECRET, CRON_TARGET_BASE_URL: "stale-base" },
    },
    { key: "helix-signal-outcomes", serviceName: "Helix-Signal-Outcomes", serviceExists: false, vars: {} },
  ];
  const { syncedCount, updates } = computeCronVarSyncPlan(entries, CRON_SECRET, INTERNAL_BASE);
  // All 3 existing services end up synced once their planned updates are
  // applied — the old buggy count would have reported only 1 (the one that
  // started already in sync), hiding that the apply step actually worked for
  // the other two.
  assert.equal(syncedCount, 3);
  assert.equal(updates.length, 3); // flow-ingest needs 2, data-correctness needs 1
});
