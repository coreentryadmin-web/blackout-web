import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const state = {
  tapeRows: [] as Array<Record<string, unknown>>,
  anomalyRows: [] as Array<Record<string, unknown>>,
  massive: null as Record<string, unknown> | null,
};

function reset() {
  state.tapeRows = [];
  state.anomalyRows = [];
  state.massive = null;
}

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
    strike: 630,
    expiry: "2026-07-29",
    direction: "bearish",
    score: 70,
    route: "flow",
    alerted_at: isoMinutesAgo(10),
    event_at: isoMinutesAgo(10),
    ...overrides,
  };
}

function cleanTapeRows() {
  return [
    tapeRow({ premium: 1_500_000 }),
    tapeRow({ premium: 1_400_000 }),
    tapeRow({ premium: 1_300_000 }),
    tapeRow({ premium: 1_200_000 }),
    tapeRow({ premium: 1_100_000 }),
    tapeRow({ premium: 1_000_000 }),
  ];
}

function findNetPremium(score: { metrics: Array<{ metric: string }> }) {
  return score.metrics.find((m) => m.metric === "net_premium");
}

test("crossCheckAgainstMassive: same skew direction + valid subset does not flag magnitude gap", async () => {
  const { verifyFlows } = await mod();
  reset();
  // UW unusual prints: 100% put-led (0% call) — filtered subset.
  state.tapeRows = cleanTapeRows();
  state.anomalyRows = [];
  state.massive = {
    ticker: "SPY",
    optionsRoot: "SPY",
    expiry: "2026-07-29",
    windowStartMs: Date.now() - 60 * 60_000,
    windowEndMs: Date.now(),
    totalPremium: 11_010_000,
    callPremium: 3_523_200,
    putPremium: 7_466_800,
    totalPrints: 400,
    callPrints: 120,
    putPrints: 280,
    callPct: 32,
    byStrike: [{ strike: 630, callPremium: 0, putPremium: 1e6, totalPremium: 1e6, prints: 10 }],
    meta: {
      contractsRequested: 40,
      contractsWithTrades: 40,
      contractsCapped: false,
      filteredPrints: 0,
      partial: false,
      sideClassifiedPrints: 200,
    },
  };

  const score = await verifyFlows(true);
  const net = findNetPremium(score);
  assert.ok(net, "net_premium metric present");
  const xcheck = net!.checks.find((c) => c.id === "flows-xcheck-massive");
  assert.ok(xcheck, "cross-provider check present");
  assert.notEqual(xcheck!.outcome, "flag", xcheck!.detail);
  assert.match(xcheck!.detail, /INDEPENDENTLY CONFIRMED/);
});

test("crossCheckAgainstMassive: contract-capped oracle does not false-flag subset ratio", async () => {
  const { verifyFlows } = await mod();
  reset();
  state.tapeRows = cleanTapeRows();
  state.anomalyRows = [];
  state.massive = {
    ticker: "SPY",
    optionsRoot: "SPY",
    expiry: "2026-07-29",
    windowStartMs: Date.now() - 60 * 60_000,
    windowEndMs: Date.now(),
    totalPremium: 1_900_000,
    callPremium: 798_000,
    putPremium: 1_102_000,
    totalPrints: 120,
    callPrints: 50,
    putPrints: 70,
    callPct: 42,
    byStrike: [{ strike: 630, callPremium: 0, putPremium: 1e6, totalPremium: 1e6, prints: 10 }],
    meta: {
      contractsRequested: 40,
      contractsWithTrades: 38,
      contractsCapped: true,
      filteredPrints: 0,
      partial: false,
      sideClassifiedPrints: 80,
    },
  };

  const score = await verifyFlows(true);
  const net = findNetPremium(score);
  const xcheck = net!.checks.find((c) => c.id === "flows-xcheck-massive");
  assert.ok(xcheck, "cross-provider check present");
  assert.notEqual(xcheck!.outcome, "flag", xcheck!.detail);
  assert.match(xcheck!.detail, /bounded oracle|contract-capped|subset ratio not assertable/i);
});

test("crossCheckAgainstMassive: post-close skips cross-check (no false FLAG)", async () => {
  const { verifyFlows } = await mod();
  reset();
  state.tapeRows = cleanTapeRows();
  state.anomalyRows = [];
  state.massive = {
    ticker: "SPY",
    optionsRoot: "SPY",
    expiry: "2026-07-29",
    windowStartMs: Date.now() - 60 * 60_000,
    windowEndMs: Date.now(),
    totalPremium: 650_000,
    callPremium: 200_000,
    putPremium: 450_000,
    totalPrints: 40,
    callPrints: 12,
    putPrints: 28,
    callPct: 31,
    byStrike: [{ strike: 630, callPremium: 0, putPremium: 1e5, totalPremium: 1e5, prints: 5 }],
    meta: {
      contractsRequested: 34,
      contractsWithTrades: 34,
      contractsCapped: false,
      filteredPrints: 0,
      partial: false,
      sideClassifiedPrints: 40,
    },
  };

  const score = await verifyFlows(false);
  const net = findNetPremium(score);
  const xcheck = net!.checks.find((c) => c.id === "flows-xcheck-massive");
  assert.ok(xcheck, "cross-provider check present");
  assert.equal(xcheck!.outcome, "skipped");
  assert.match(xcheck!.detail, /Market closed/);
});

test("crossCheckAgainstMassive: opposite skew still flags", async () => {
  const { verifyFlows } = await mod();
  reset();
  state.tapeRows = cleanTapeRows().map((r) => ({
    ...r,
    option_type: "call",
    premium: 1_500_000,
  }));
  state.anomalyRows = [];
  state.massive = {
    ticker: "SPY",
    optionsRoot: "SPY",
    expiry: "2026-07-29",
    windowStartMs: Date.now() - 60 * 60_000,
    windowEndMs: Date.now(),
    totalPremium: 10_000_000,
    callPremium: 2_000_000,
    putPremium: 8_000_000,
    totalPrints: 400,
    callPrints: 80,
    putPrints: 320,
    callPct: 20,
    byStrike: [{ strike: 630, callPremium: 0, putPremium: 1e6, totalPremium: 1e6, prints: 10 }],
    meta: {
      contractsRequested: 40,
      contractsWithTrades: 40,
      contractsCapped: false,
      filteredPrints: 0,
      partial: false,
      sideClassifiedPrints: 200,
    },
  };

  const score = await verifyFlows(true);
  const net = findNetPremium(score);
  const xcheck = net!.checks.find((c) => c.id === "flows-xcheck-massive");
  assert.equal(xcheck!.outcome, "flag");
  assert.match(xcheck!.detail, /OPPOSITE call\/put skew/);
});
