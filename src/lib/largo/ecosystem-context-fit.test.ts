import assert from "node:assert/strict";
import { test } from "node:test";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import { fitEcosystemContextForModel } from "@/lib/largo/ecosystem-context-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

function baseContext(): EcosystemContext {
  return {
    ticker: "SPX",
    zerodte_today: null,
    nighthawk_recent: null,
    recent_audit_entries: [],
    recent_flow: null,
    flow_full_state: null,
    recent_anomalies: [],
    spx_play: null,
    spx_full_state: null,
    spx_desk_convergence: null,
    flow_feed_fresh: true,
    gex_positioning: null,
    vector_full_state: null,
    arsenal: {
      scope: "index",
      earnings: null,
      fundamentals: null,
      related: null,
      news: null,
      macro: null,
      breadth: null,
      unavailable_sources: [],
    },
  };
}

test("fitEcosystemContextForModel caps audit rows and reports truncation", () => {
  const raw = baseContext();
  raw.recent_audit_entries = Array.from({ length: 12 }, (_, i) => ({
    alert_type: "zerodte",
    fired_at: `2026-09-03T10:0${i}:00.000Z`,
    confidence_label: "A",
    trigger_reason: "test",
    outcome: null,
  }));

  const { fitted } = fitEcosystemContextForModel(raw);
  assert.equal(fitted.recent_audit_entries.length, 5);
  assert.equal(fitted.recent_audit_entries_total, 12);
  assert.equal(fitted.recent_audit_entries_truncated, true);
});

test("fitEcosystemContextForModel stays under Largo char budget for heavy SPX flow tape", () => {
  const raw = baseContext();
  raw.flow_full_state = {
    count: 200,
    total_premium: 9_000_000,
    top_tickers: [],
    strike_stacks: [],
    recent: Array.from({ length: 120 }, (_, i) => ({
      ticker: "SPX",
      premium: 50_000 + i,
      option_type: "CALL",
      strike: 5900 + i,
      expiry: "2026-09-05",
      direction: "bullish",
      score: 70,
      route: "sweep",
      alerted_at: "2026-09-03T14:00:00.000Z",
    })),
  };

  const { fitted } = fitEcosystemContextForModel(raw);
  assert.ok(fitted.flow_full_state!.recent.length <= 25);
  assert.ok(JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET);
});
