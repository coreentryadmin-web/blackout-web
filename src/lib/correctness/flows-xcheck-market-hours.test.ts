import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const state = {
  tapeRows: [] as Array<Record<string, unknown>>,
  anomalyRows: [] as Array<Record<string, unknown>>,
  massive: null as {
    totalPremium: number;
    callPct: number;
    byStrike: Array<{ strike: number }>;
    meta: { contractsWithTrades: number; contractsRequested: number; partial: boolean };
  } | null,
};

mock.module("../db", {
  namedExports: {
    fetchRecentFlows: async (params: { since_hours?: number }) => {
      if (params?.since_hours === 0.5) return state.anomalyRows;
      return state.tapeRows;
    },
  },
});
mock.module("../providers/config", {
  namedExports: { polygonConfigured: () => true },
});
mock.module("../providers/option-trades", {
  namedExports: {
    fetchOptionTrades: async () => state.massive,
  },
});
mock.module("../providers/spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-29" },
});

const mod = () => import("./flows-verifier");

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

function tapeRow(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "SPY",
    premium: 500_000,
    option_type: "put",
    strike: 730,
    expiry: "2026-07-29",
    direction: "bearish",
    score: 70,
    route: "flow",
    alerted_at: isoMinutesAgo(5),
    event_at: isoMinutesAgo(5),
    ...overrides,
  };
}

test("verifyFlows: UW-vs-Massive cross-check skips when market is closed", async () => {
  const { verifyFlows } = await mod();
  state.tapeRows = [
    tapeRow({ option_type: "put", premium: 500_000 }),
    tapeRow({ option_type: "put", premium: 480_000 }),
    tapeRow({ option_type: "put", premium: 460_000 }),
    tapeRow({ option_type: "call", premium: 440_000 }),
    tapeRow({ option_type: "call", premium: 420_000 }),
    tapeRow({ option_type: "call", premium: 400_000 }),
  ];
  state.anomalyRows = [];
  state.massive = {
    totalPremium: 12_000_000,
    callPct: 29,
    byStrike: [{ strike: 720 }, { strike: 740 }],
    meta: { contractsWithTrades: 40, contractsRequested: 40, partial: false },
  };

  const score = await verifyFlows(false);
  const netPrem = score.metrics.find((m) => m.metric === "net_premium");
  assert.ok(netPrem, "net_premium metric must be present");
  const xcheck = netPrem!.checks.find((c) => c.id === "flows-xcheck-massive");
  assert.ok(xcheck, "flows-xcheck-massive check must be present");
  assert.equal(xcheck!.outcome, "skipped");
  assert.match(xcheck!.detail, /Market closed/);
});
