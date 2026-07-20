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

test("computeFlowStrikeStacks: input cap keeps most recent alerts, not tape head", () => {
  const now = Date.parse("2026-07-20T16:00:00.000Z");
  const staleHead = Array.from({ length: 600 }, (_, i) => ({
    ticker: "OLD",
    strike: 100 + i,
    option_type: "CALL",
    expiry: "2026-01-01",
    premium: 10_000_000 - i,
    alerted_at: "2026-01-01T10:00:00.000Z",
  }));
  const freshStack = [
    {
      ticker: "NVDA",
      strike: 180,
      option_type: "CALL",
      expiry: "2026-07-25",
      premium: 500_000,
      alerted_at: "2026-07-20T15:58:00.000Z",
    },
    {
      ticker: "NVDA",
      strike: 180,
      option_type: "CALL",
      expiry: "2026-07-25",
      premium: 400_000,
      alerted_at: "2026-07-20T15:59:00.000Z",
    },
  ];
  const alerts = [...staleHead, ...freshStack];
  const stacks = computeFlowStrikeStacks(alerts, {
    minAlerts: 2,
    limit: 5,
    windowMs: 15 * 60 * 1000,
    nowMs: now,
  });
  assert.equal(stacks.length, 1, "fresh NVDA stack survives 600 stale head rows");
  assert.equal(stacks[0]!.ticker, "NVDA");
  assert.equal(stacks[0]!.strike, 180);
});
