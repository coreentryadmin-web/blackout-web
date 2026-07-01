import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression for the GEX-regime enum mismatch: gammaRegime() (see
// src/lib/providers/gamma-desk.ts) only ever returns
// "mean_revert" | "amplification" | "unknown", but deriveComposite() used to
// compare against the literals "long"/"short", which never matched — so
// every RTH tick fell through to the NEUTRAL fallback regardless of actual
// dealer positioning.
//
// route.ts pulls in DB/Clerk/desk-loader modules (one of which imports
// "server-only") purely as a side effect of module load, so its direct
// dependencies are stubbed out here before importing it — mirroring the
// pattern in src/lib/__tests__/critical-api-routes.test.ts — to load the
// route module in a plain node:test process and exercise the exported pure
// function.
//
// Run: npx tsx --test src/app/api/cron/market-regime-detector/deriveComposite.test.ts

mock.module("@/lib/market-api-auth", {
  namedExports: { isCronAuthorized: () => true },
});
mock.module("@/lib/spx-play-session-guards", {
  namedExports: { isSpxEngineCronWindow: () => true },
});
mock.module("@/lib/cron-run", {
  namedExports: { logCronRun: async () => {} },
});
mock.module("@/lib/db", {
  namedExports: {
    requireDatabaseInProduction: () => null,
    fetchRecentFlows: async () => [],
    dbQuery: async () => ({ rowCount: 0, rows: [] }),
  },
});
mock.module("@/lib/spx-desk-loader", {
  namedExports: {
    loadMergedSpxDesk: async () => ({ merged: { available: false } }),
  },
});

test("deriveComposite maps mean_revert + up to MEAN_REVERT_TRENDING_UP", async () => {
  const { deriveComposite } = await import("./route");
  const { composite } = deriveComposite("mean_revert", "up", "bullish");
  assert.equal(composite, "MEAN_REVERT_TRENDING_UP");
});

test("deriveComposite maps mean_revert + down to MEAN_REVERT_TRENDING_DOWN", async () => {
  const { deriveComposite } = await import("./route");
  const { composite } = deriveComposite("mean_revert", "down", "bearish");
  assert.equal(composite, "MEAN_REVERT_TRENDING_DOWN");
});

test("deriveComposite maps amplification + up to AMPLIFY_BREAKOUT", async () => {
  const { deriveComposite } = await import("./route");
  const { composite } = deriveComposite("amplification", "up", "bullish");
  assert.equal(composite, "AMPLIFY_BREAKOUT");
});

test("deriveComposite maps amplification + down to AMPLIFY_BREAKDOWN", async () => {
  const { deriveComposite } = await import("./route");
  const { composite } = deriveComposite("amplification", "down", "bearish");
  assert.equal(composite, "AMPLIFY_BREAKDOWN");
});

test("deriveComposite maps amplification + sideways to AMPLIFY_MIXED", async () => {
  const { deriveComposite } = await import("./route");
  const { composite } = deriveComposite("amplification", "sideways", "mixed");
  assert.equal(composite, "AMPLIFY_MIXED");
});

test("deriveComposite maps mean_revert + sideways to MEAN_REVERT_MIXED", async () => {
  const { deriveComposite } = await import("./route");
  const { composite } = deriveComposite("mean_revert", "sideways", "mixed");
  assert.equal(composite, "MEAN_REVERT_MIXED");
});

test("deriveComposite maps unknown + sideways to NEUTRAL", async () => {
  const { deriveComposite } = await import("./route");
  const { composite } = deriveComposite("unknown", "sideways", "neutral");
  assert.equal(composite, "NEUTRAL");
});
