import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowRow } from "@/lib/db";
import { fitPostgresFlowsForModel } from "@/lib/largo/postgres-flows-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

function flowRow(i: number): FlowRow {
  return {
    ticker: "SPX",
    premium: 50_000 + i,
    option_type: i % 2 === 0 ? "CALL" : "PUT",
    strike: 5900 + i,
    expiry: "2026-09-05",
    direction: "bullish",
    score: 70,
    route: "sweep",
    alerted_at: "2026-09-03T14:00:00.000Z",
  };
}

test("fitPostgresFlowsForModel caps prints and reports truncation", () => {
  const rows = Array.from({ length: 80 }, (_, i) => flowRow(i));
  const { fitted } = fitPostgresFlowsForModel(rows);
  assert.ok(fitted.prints.length <= 25);
  assert.equal(fitted.total, 80);
  assert.equal(fitted.truncated, true);
  assert.equal(fitted.shown, fitted.prints.length);
});

test("fitPostgresFlowsForModel keeps pull_skew over the full pull, not just the sample", () => {
  const rows = Array.from({ length: 40 }, (_, i) => flowRow(i));
  const { fitted } = fitPostgresFlowsForModel(rows);
  assert.equal(fitted.pull_skew.alert_count, 40);
  assert.equal(fitted.truncated, true);
});

test("fitPostgresFlowsForModel stays under Largo char budget at measured size", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    ...flowRow(i),
    tags: ["sweep", "block", "repeat"],
    note: "x".repeat(120),
  })) as FlowRow[];
  const { fitted } = fitPostgresFlowsForModel(rows);
  assert.ok(JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET);
});
