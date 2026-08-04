import { test, mock } from "node:test";
import assert from "node:assert/strict";

const state = {
  dbConfigured: true,
  cursor: null as string | null,
  inserted: [] as Array<Record<string, unknown>>,
};

function resetState() {
  state.dbConfigured = true;
  state.cursor = null;
  state.inserted = [];
}

mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    getMeta: async (key: string) =>
      key === "zerodte_discovery_event_cursor" ? state.cursor : null,
    setMeta: async (key: string, value: string) => {
      if (key === "zerodte_discovery_event_cursor") state.cursor = value;
    },
    insertZeroDteDiscoveryEvent: async (row: Record<string, unknown>) => {
      state.inserted.push(row);
    },
  },
});
mock.module("../providers/spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-06" },
});

const mod = () => import("./discovery-events-persist");

test("persistDiscoveryDetectedEvents: throttles duplicate score bucket per ticker", async () => {
  resetState();
  const { persistDiscoveryDetectedEvents } = await mod();
  const setup = {
    ticker: "NVDA",
    score: 72,
    discovery_origin: ["FLOW"],
    contract_horizon: "ZERO_DTE",
    direction: "long",
    play_type: "DIRECTIONAL",
    gate: { verdict: "COMMIT" },
  } as import("./board").EnrichedZeroDteSetup;

  assert.equal(await persistDiscoveryDetectedEvents([setup], null), 1);
  assert.equal(await persistDiscoveryDetectedEvents([setup], null), 0);
  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0]!.kind, "detected");
});

test("persistDiscoveryGateBlockedEvents: gate_blocked throttle", async () => {
  resetState();
  const { persistDiscoveryGateBlockedEvents } = await mod();
  const rej = {
    ticker: "AMD",
    gate_failed: "min_gross",
    direction: "long",
    reason: "below floor",
    gross_premium: 50_000,
    threshold: 200_000,
  } as import("./board").ZeroDteGateRejection;

  assert.equal(await persistDiscoveryGateBlockedEvents([rej]), 1);
  assert.equal(await persistDiscoveryGateBlockedEvents([rej]), 0);
  assert.equal(state.inserted[0]!.kind, "gate_blocked");
});

test("persistDiscoveryCommitEvents: one commit row per ticker per session", async () => {
  resetState();
  const { persistDiscoveryCommitEvents } = await mod();
  const setup = {
    ticker: "META",
    score: 80,
    discovery_origin: ["FLOW", "BREAKOUT"],
    contract_horizon: "ZERO_DTE",
    direction: "long",
    play_type: "DIRECTIONAL",
    actual_dte_at_commit: 0,
    gate: { verdict: "COMMIT" },
  } as import("./board").EnrichedZeroDteSetup;

  assert.equal(await persistDiscoveryCommitEvents([setup]), 1);
  assert.equal(await persistDiscoveryCommitEvents([setup]), 0);
  assert.equal(state.inserted[0]!.kind, "commit");
});
