import assert from "node:assert/strict";
import { test } from "node:test";
import { mapAlertAuditLargoRow } from "@/lib/db";

test("mapAlertAuditLargoRow includes final_output and source_table", () => {
  const row = mapAlertAuditLargoRow({
    id: 7,
    alert_type: "zerodte",
    source_table: "zerodte_setup_log",
    ticker: "NVDA",
    direction: "long",
    fired_at: "2026-09-03T14:30:00.000Z",
    confidence_score: "0.82",
    confidence_label: "A",
    trigger_reason: "gates cleared",
    outcome: "target",
    final_output: { options_play: "NVDA 180C 9/5", entry_premium: 4.2 },
  });

  assert.equal(row.id, 7);
  assert.equal(row.source_table, "zerodte_setup_log");
  assert.deepEqual(row.final_output, { options_play: "NVDA 180C 9/5", entry_premium: 4.2 });
});

test("mapAlertAuditLargoRow null final_output stays null", () => {
  const row = mapAlertAuditLargoRow({
    id: 1,
    alert_type: "nighthawk_rejected",
    source_table: "claude_edition_synthesis",
    ticker: "AAPL",
    direction: null,
    fired_at: "2026-09-03T14:30:00.000Z",
    confidence_score: null,
    confidence_label: null,
    trigger_reason: "premium cap",
    outcome: null,
    final_output: null,
  });

  assert.equal(row.final_output, null);
});
