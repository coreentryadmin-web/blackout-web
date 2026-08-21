import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { composeFlowBrief } from "@/lib/bie/flow-brief";
import type { FlowAlert } from "@/lib/api";

describe("composeFlowBrief", () => {
  test("builds a deterministic memo from flow stats", () => {
    const alerts = [
      {
        ticker: "SPX",
        option_type: "CALL",
        premium: 18_000_000,
        route: "SWEEP",
        strike: 6000,
        expiry: "2026-07-10",
        score: 90,
      },
      {
        ticker: "AAPL",
        option_type: "PUT",
        premium: 500_000,
        route: "BLOCK",
        strike: 200,
        expiry: "2026-07-10",
        score: 40,
      },
    ] as FlowAlert[];

    const brief = composeFlowBrief(alerts, []);
    assert.ok(brief);
    assert.match(brief!, /SPX/);
    assert.match(brief!, /call-led|put-led|mixed/);
  });
});

test("an all-typeless tape does not claim a 50/50 balance or a 'mixed' verdict", () => {
  // Same defect class as get_helix_tape_analytics' call_pct:50, one surface over — and this memo
  // is member-visible via /api/market/flow-brief and the /flows FlowBrief panel. The old output
  // was: "1 prints · 50% call premium. Flow is mixed ($0 notional, 1 whale prints >$1M)" —
  // a balanced verdict, zero notional and a whale, asserted together.
  const memo = composeFlowBrief(
    [{ ticker: "SPY", premium: 3_000_000, option_type: "UNKNOWN", strike: 1, expiry: "2026-08-20",
       route: "SWEEP", alert_rule: "Sweep", score: 1, direction: "unknown", alerted_at: "" } as never],
    []
  );
  assert.ok(!memo.includes("50%"), `must not fabricate a skew: ${memo}`);
  assert.ok(!memo.includes("mixed"), `"mixed" is a measured verdict: ${memo}`);
  assert.ok(memo.includes("not measured") || memo.includes("Side unknown"), memo);
  // The whale count does NOT depend on side, so it stays.
  assert.ok(memo.includes("1 whale"), memo);
});

test("a measurable tape still reports its skew and bias unchanged", () => {
  const memo = composeFlowBrief(
    [
      { ticker: "SPY", premium: 9_000_000, option_type: "CALL", strike: 1, expiry: "2026-08-20",
        route: "SWEEP", alert_rule: "Sweep", score: 1, direction: "bullish", alerted_at: "" } as never,
      { ticker: "SPY", premium: 1_000_000, option_type: "PUT", strike: 1, expiry: "2026-08-20",
        route: "SWEEP", alert_rule: "Sweep", score: 1, direction: "bearish", alerted_at: "" } as never,
    ],
    []
  );
  assert.ok(memo.includes("90% call premium"), memo);
  assert.ok(memo.includes("call-led"), memo);
});
