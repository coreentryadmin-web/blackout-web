import assert from "node:assert/strict";
import { test } from "node:test";
import { fitHelixSignalOutcomesForModel } from "@/lib/largo/helix-signal-outcomes-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

test("fitHelixSignalOutcomesForModel caps rows and preserves summary", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    ticker: "NVDA",
    signal_type: "velocity_spike",
    direction: "bullish",
    outcome: "continued",
    fired_at: new Date().toISOString(),
    fired_session: "2026-09-03",
    price_at_fire: 900 + i,
    price_1h: 905 + i,
  }));
  const raw = {
    available: true,
    rows,
    rows_shown: 20,
    rows_summarized: 40,
    summary: {
      continuation_rate_pct: 55,
      graded: 30,
      pending: 10,
      by_signal_type: Array.from({ length: 4 }, (_, i) => ({
        signal_type: `type_${i}`,
        graded: 10,
        continuation_rate_pct: 50 + i,
      })),
    },
    outcome_values: ["continued", "reversed", "flat", "pending"],
  };
  const { fitted } = fitHelixSignalOutcomesForModel(raw);
  assert.ok((fitted.rows as unknown[]).length <= 15);
  assert.equal(fitted.rows_truncated, true);
  assert.equal(fitted.rows_summarized, 40);
  assert.ok(fitted.summary);
  assert.ok(JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET);
});
