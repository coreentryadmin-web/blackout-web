import assert from "node:assert/strict";
import { test } from "node:test";
import { fitPlaybookShadowHistoryForModel } from "@/lib/largo/playbook-shadow-history-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

test("fitPlaybookShadowHistoryForModel caps observations and stays under budget", () => {
  const observations = Array.from({ length: 80 }, (_, i) => ({
    id: i,
    observed_at: new Date().toISOString(),
    primary_playbook_id: `pb-${i}`,
    regime: "positive",
    gamma_regime: "long_gamma",
    price_at_observation: 5800 + i,
    engine_action: "SCANNING",
    engine_score: 70,
    verdicts: Array.from({ length: 12 }, (_, j) => ({
      playbook_id: `pb-${j}`,
      trigger_fired: true,
      precondition_match: true,
      primary: j === 0,
      detail: "d".repeat(200),
    })),
  }));
  const { fitted } = fitPlaybookShadowHistoryForModel({
    session_date: "2026-09-03",
    observations,
  });
  assert.ok(fitted.observations.length <= 20);
  assert.equal(fitted.total, 80);
  assert.equal(fitted.truncated, true);
  assert.ok(JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET);
});
