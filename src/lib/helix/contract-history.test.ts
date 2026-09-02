import { test } from "node:test";
import assert from "node:assert/strict";
import { groupFlowHistoryByDay, type HistoryRow } from "./contract-history";

function row(alerted_at: string, option_type: string, premium: number): HistoryRow {
  return { alerted_at, option_type, premium };
}

test("groupFlowHistoryByDay sums call/put premium separately per ET calendar day", () => {
  const days = groupFlowHistoryByDay([
    row("2026-08-15T14:00:00.000Z", "CALL", 100_000), // 10:00 ET
    row("2026-08-15T18:30:00.000Z", "PUT", 40_000), // 14:30 ET, same day
    row("2026-08-16T14:00:00.000Z", "CALL", 250_000), // next day
  ]);

  assert.equal(days.length, 2);
  const d15 = days.find((d) => d.date === "2026-08-15")!;
  assert.equal(d15.callPremium, 100_000);
  assert.equal(d15.putPremium, 40_000);
  assert.equal(d15.total, 140_000);
  assert.equal(d15.count, 2);
  const d16 = days.find((d) => d.date === "2026-08-16")!;
  assert.equal(d16.callPremium, 250_000);
  assert.equal(d16.count, 1);
});

test("groupFlowHistoryByDay sorts newest day first", () => {
  const days = groupFlowHistoryByDay([
    row("2026-08-01T14:00:00.000Z", "CALL", 1),
    row("2026-08-20T14:00:00.000Z", "CALL", 1),
    row("2026-08-10T14:00:00.000Z", "CALL", 1),
  ]);
  assert.deepEqual(
    days.map((d) => d.date),
    ["2026-08-20", "2026-08-10", "2026-08-01"]
  );
});

test("groupFlowHistoryByDay drops rows with an empty or unparseable alerted_at, never buckets them under a guessed date", () => {
  const days = groupFlowHistoryByDay([
    row("", "CALL", 500_000),
    row("not-a-real-timestamp", "CALL", 500_000),
    row("2026-08-15T14:00:00.000Z", "CALL", 100_000),
  ]);
  assert.equal(days.length, 1, "only the one real-timestamp row should produce a bucket");
  assert.equal(days[0].total, 100_000);
});

test("groupFlowHistoryByDay buckets by the print's ET calendar date, not its raw UTC date", () => {
  // 2026-08-15T02:30:00Z is still 2026-08-14 in America/New_York (22:30 ET the prior evening) —
  // a naive UTC-date bucketing would misfile this into the wrong session.
  const days = groupFlowHistoryByDay([row("2026-08-15T02:30:00.000Z", "CALL", 100_000)]);
  assert.equal(days.length, 1);
  assert.equal(days[0].date, "2026-08-14");
});

test("groupFlowHistoryByDay: an unknown option_type contributes to total but neither call nor put bucket", () => {
  const days = groupFlowHistoryByDay([row("2026-08-15T14:00:00.000Z", "UNKNOWN", 100_000)]);
  assert.equal(days[0].callPremium, 0);
  assert.equal(days[0].putPremium, 0);
  assert.equal(days[0].total, 0, "premium from an unclassified side is never silently counted as either");
  assert.equal(days[0].count, 1, "the print itself is still counted");
});

test("groupFlowHistoryByDay: empty input yields no days", () => {
  assert.deepEqual(groupFlowHistoryByDay([]), []);
});
