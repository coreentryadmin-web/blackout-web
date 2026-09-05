import assert from "node:assert/strict";
import { test, mock } from "node:test";

const rows = [
  {
    ticker: "NVDA",
    premium: 100_000,
    option_type: "call",
    expiry: "2026-07-18",
    strike: 130,
    direction: "bullish",
    score: 1,
    route: "sweep",
    alerted_at: "2026-07-13T14:00:00.000Z",
    event_at: "2026-07-13T14:05:00.000Z",
  },
];

mock.module("../db", {
  namedExports: {
    fetchRecentFlows: async () => rows,
  },
});

test("getFlowTapeSummary stamps as_of from newest print event_at (CQ-083)", async () => {
  const { getFlowTapeSummary } = await import("./flow-service.ts");
  const summary = await getFlowTapeSummary({ limit: 10 });
  assert.equal(summary.as_of, "2026-07-13 10:05 ET");
  assert.equal(summary.count, 1);
});
