import assert from "node:assert/strict";
import test from "node:test";
import { thesisFirstFromEntryContext } from "./thesis-first-rehydrate";

test("thesisFirstFromEntryContext rebuilds compact entry_context blob", () => {
  const blob = {
    rail_scores: { FLOW: 88, BREAKOUT: 84 },
    rails_fired: ["FLOW", "BREAKOUT"],
    summaries: { FLOW: "campaign", BREAKOUT: "triggered" },
    systems_aligned: 2,
    trade_archetype: "BREAKOUT",
    archetype_score: 82,
    structural_state: "TRIGGERED",
    trigger_price: 181.5,
    rank_tier: "A",
    archetype_gate: "PASS",
    archetype_blocks: [],
    disagreeing_rails: [],
    desk_evidence: [
      { desk: "HELIX", status: "aligned", text: "flow aligned" },
    ],
    expression_horizon: "ZERO_DTE",
    expression_dte: 0,
    expression_strike: 182,
    expression_expiry: "2026-07-25",
    expression_score: 91,
    expression_rationale: "ATM 0DTE",
  };

  const out = thesisFirstFromEntryContext(blob, "nvda", "long");
  assert.ok(out);
  assert.equal(out!.rank_tier, "A");
  assert.equal(out!.thesis.ticker, "NVDA");
  assert.equal(out!.thesis.systems_aligned, 2);
  assert.equal(out!.desk_evidence?.length, 1);
  assert.equal(out!.expression?.contract?.strike, 182);
});

test("thesisFirstFromEntryContext passes through full pipeline objects", () => {
  const full = {
    thesis: {
      ticker: "TSLA",
      direction: "long" as const,
      rail_scores: { FLOW: 70 },
      rails_fired: ["FLOW"] as const,
      systems_aligned: 1,
      trade_archetype: "FLOW_FOLLOWING" as const,
      archetype_score: 70,
      structural_state: null,
      trigger_price: null,
      summaries: {},
      disagreeing_rails: [],
    },
    archetype_gates: { verdict: "PASS" as const, archetype: "FLOW_FOLLOWING" as const, blocks: [], notes: [] },
    expression: null,
    rank_tier: "B" as const,
  };
  const out = thesisFirstFromEntryContext(full as unknown as Record<string, unknown>, "tsla", "long");
  assert.equal(out?.rank_tier, "B");
  assert.equal(out?.thesis.ticker, "TSLA");
});

test("thesisFirstFromEntryContext returns null on empty blob", () => {
  assert.equal(thesisFirstFromEntryContext(null, "x", "long"), null);
  assert.equal(thesisFirstFromEntryContext({}, "x", "long"), null);
});
