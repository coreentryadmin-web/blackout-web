import test from "node:test";
import assert from "node:assert/strict";
import type { FlowAlert } from "@/lib/api";
import {
  netPremiumLeaders,
  routeBreakdown,
  expiryConcentration,
  sessionFlowSkew,
} from "./helix-tape-analytics";

const alerts: FlowAlert[] = [
  {
    ticker: "NVDA",
    premium: 2_000_000,
    option_type: "CALL",
    strike: 900,
    expiry: "2026-08-15",
    route: "SWEEP",
    alert_rule: "RepeatedHitsSweep",
    score: 80,
    direction: "bullish",
    alerted_at: "2026-08-12T15:00:00Z",
    dte: 3,
  },
  {
    ticker: "NVDA",
    premium: 500_000,
    option_type: "PUT",
    strike: 880,
    expiry: "2026-08-15",
    route: "BLOCK",
    alert_rule: "RepeatedHitsBlock",
    score: 60,
    direction: "bearish",
    alerted_at: "2026-08-12T15:01:00Z",
    dte: 3,
  },
  {
    ticker: "SPY",
    premium: 1_500_000,
    option_type: "CALL",
    strike: 640,
    expiry: "2026-08-12",
    route: "SWEEP",
    alert_rule: "RepeatedHitsSweep",
    score: 70,
    direction: "bullish",
    alerted_at: "2026-08-12T15:02:00Z",
    dte: 0,
  },
];

test("netPremiumLeaders ranks by total premium", () => {
  const rows = netPremiumLeaders(alerts);
  assert.equal(rows[0]?.ticker, "NVDA");
  assert.equal(rows[0]?.total, 2_500_000);
});

test("routeBreakdown aggregates SWEEP vs BLOCK", () => {
  const rows = routeBreakdown(alerts);
  const sweep = rows.find((r) => r.route === "SWEEP");
  assert.ok(sweep);
  assert.equal(sweep!.count, 2);
});

test("expiryConcentration groups by expiry date", () => {
  const rows = expiryConcentration(alerts);
  assert.ok(rows.some((r) => r.expiry.startsWith("2026-08-15")));
});

test("sessionFlowSkew computes call pct", () => {
  const skew = sessionFlowSkew(alerts);
  assert.equal(skew.alert_count, 3);
  assert.ok(skew.call_pct >= 50 && skew.call_pct <= 100);
});
