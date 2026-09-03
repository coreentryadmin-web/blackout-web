import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowRow } from "@/lib/db";
import { fitFlowTapeForModel } from "@/lib/largo/flow-tape-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

function flowRow(i: number): FlowRow {
  return {
    ticker: "SPX",
    premium: 50_000 + i,
    option_type: "CALL",
    strike: 5900 + i,
    expiry: "2026-09-05",
    direction: "bullish",
    score: 70,
    route: "sweep",
    alerted_at: "2026-09-03T14:00:00.000Z",
  };
}

test("fitFlowTapeForModel caps recent prints and reports truncation", () => {
  const raw = {
    count: 120,
    total_premium: 9_000_000,
    top_tickers: [{ ticker: "SPX", premium: 9_000_000, count: 120 }],
    strike_stacks: [],
    recent: Array.from({ length: 120 }, (_, i) => flowRow(i)),
  };

  const { fitted } = fitFlowTapeForModel(raw);
  assert.ok(fitted.recent.length <= 25);
  assert.equal(fitted.recent_total, 120);
  assert.equal(fitted.recent_truncated, true);
  assert.equal(fitted.count, 120, "aggregate count stays honest");
});

test("fitFlowTapeForModel stays under Largo char budget for heavy gex-enriched tape", () => {
  const raw = {
    count: 80,
    total_premium: 5_000_000,
    top_tickers: [],
    strike_stacks: [],
    pull_skew: {
      call_pct: 62,
      call_premium: 3_100_000,
      put_premium: 1_900_000,
      total_premium: 5_000_000,
      prints: 80,
    },
    recent: Array.from({ length: 80 }, (_, i) => ({
      ...flowRow(i),
      gex_proximity: "near_call_wall" as const,
    })),
  };

  const { fitted } = fitFlowTapeForModel(raw);
  assert.ok(JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET);
});
