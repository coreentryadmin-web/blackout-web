import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFlowStrikeStacks } from "./flow-strike-stacks";

test("computeFlowStrikeStacks: recent_hit_count respects windowMs", () => {
  const now = Date.parse("2026-07-20T16:00:00.000Z");
  const alerts = [
    {
      ticker: "NVDA",
      strike: 180,
      option_type: "CALL",
      expiry: "2026-07-25",
      premium: 500_000,
      event_at: "2026-07-20T15:50:00.000Z",
      alerted_at: "2026-07-20T15:50:00.000Z",
    },
    {
      ticker: "NVDA",
      strike: 180,
      option_type: "CALL",
      expiry: "2026-07-25",
      premium: 400_000,
      event_at: "2026-07-20T15:55:00.000Z",
      alerted_at: "2026-07-20T15:55:00.000Z",
    },
    {
      ticker: "NVDA",
      strike: 180,
      option_type: "CALL",
      expiry: "2026-07-25",
      premium: 300_000,
      event_at: "2026-07-20T14:00:00.000Z",
      alerted_at: "2026-07-20T14:00:00.000Z",
    },
  ];
  const stacks = computeFlowStrikeStacks(alerts, {
    minAlerts: 2,
    limit: 5,
    windowMs: 15 * 60 * 1000,
    nowMs: now,
  });
  assert.equal(stacks.length, 1);
  assert.equal(stacks[0]!.recent_hit_count, 2);
  assert.equal(stacks[0]!.alert_count, 3);
});
