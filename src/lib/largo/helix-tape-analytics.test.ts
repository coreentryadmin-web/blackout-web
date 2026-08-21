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

// ── Expiry horizon / session-anchor guards ───────────────────────────────────
// Regression cover for the defect where `expiry_concentration` ranked RAW EXPIRY DATES by
// premium, kept the top 8, and so dropped the 0DTE bucket entirely on a normal tape while
// handing the model bare date strings with no session to measure them against.

import {
  expiryHorizonConcentration,
  expiryHorizonLabel,
  EXPIRY_HORIZONS,
} from "./helix-tape-analytics";

/** Build a print with an explicit dte — the field the tape's SQL supplies. */
function print(over: Partial<FlowAlert> & { dte: number; premium: number }): FlowAlert {
  return {
    ticker: "AAA",
    option_type: "CALL",
    strike: 100,
    expiry: "2026-01-01",
    route: "SWEEP",
    alert_rule: "Sweep",
    score: 10,
    direction: "bullish",
    alerted_at: "2026-08-20T15:00:00Z",
    ...over,
  } as FlowAlert;
}

test("expiryHorizonLabel matches the member panel's buckets", () => {
  assert.equal(expiryHorizonLabel(0), "0DTE");
  assert.equal(expiryHorizonLabel(1), "This week");
  assert.equal(expiryHorizonLabel(7), "This week");
  assert.equal(expiryHorizonLabel(8), "Monthly");
  assert.equal(expiryHorizonLabel(30), "Monthly");
  assert.equal(expiryHorizonLabel(31), "LEAPS");
});

test("expiryHorizonLabel folds an ALREADY-EXPIRED print into 0DTE, not 'This week'", () => {
  // SQL returns expiry - ET_today, which goes negative for an expired row. The panel's
  // `dte === 0` test sends those to the `<= 7` branch, filing an expired contract under a
  // FUTURE horizon. Anything <= 0 belongs at the near end.
  assert.equal(expiryHorizonLabel(-1), "0DTE");
  assert.equal(expiryHorizonLabel(-30), "0DTE");
});

test("0DTE survives even when it is the SMALLEST bucket — the truncation bug", () => {
  // Live shape, 2026-08-20: one small 0DTE bucket against far-dated whale blocks. Under the
  // old top-8-by-premium-over-raw-dates aggregation the 0DTE row ranked 16th of 24 and never
  // reached the model.
  const alerts = [
    print({ dte: 0, premium: 40_000, expiry: "2026-08-20" }),
    ...Array.from({ length: 12 }, (_, i) =>
      print({ dte: 60 + i * 30, premium: 10_000_000, expiry: `2027-0${(i % 9) + 1}-15` })
    ),
  ];
  const horizons = expiryHorizonConcentration(alerts);
  const zero = horizons.find((h) => h.horizon === "0DTE");
  assert.ok(zero, "0DTE bucket must be present however small");
  assert.equal(zero!.premium, 40_000);
  assert.equal(zero!.count, 1);
  // At most four buckets exist, so the horizon view is never truncated.
  assert.ok(horizons.length <= EXPIRY_HORIZONS.length);
});

test("horizon buckets come back in chronological order, not premium order", () => {
  const rows = expiryHorizonConcentration([
    print({ dte: 200, premium: 9_000_000 }),
    print({ dte: 0, premium: 1_000 }),
    print({ dte: 3, premium: 5_000 }),
  ]);
  assert.deepEqual(rows.map((r) => r.horizon), ["0DTE", "This week", "LEAPS"]);
});

test("horizon buckets carry the call/put split the panel shows", () => {
  const rows = expiryHorizonConcentration([
    print({ dte: 0, premium: 750_000, option_type: "CALL" }),
    print({ dte: 0, premium: 250_000, option_type: "PUT" }),
  ]);
  assert.equal(rows[0]?.call_premium, 750_000);
  assert.equal(rows[0]?.put_premium, 250_000);
  assert.equal(rows[0]?.call_pct, 75);
});

test("a horizon with no measurable premium reports call_pct null, never a 50/50 balance", () => {
  // gap-#6: a typeless print counts toward neither side. It is still a print, so `count` is 1
  // and `premium` is 0 — and an unmeasurable skew must not read to the model as "balanced".
  const rows = expiryHorizonConcentration([
    print({ dte: 0, premium: 3_000_000, option_type: "UNKNOWN" }),
  ]);
  assert.equal(rows[0]?.count, 1);
  assert.equal(rows[0]?.premium, 0);
  assert.equal(rows[0]?.call_pct, null);
});

test("expiryConcentration rows carry dte + horizon so no date has to be inferred", () => {
  const rows = expiryConcentration([
    print({ dte: 0, premium: 1_000_000, expiry: "2026-08-20" }),
    print({ dte: 1, premium: 9_000_000, expiry: "2026-08-21" }),
  ]);
  const today = rows.find((r) => r.expiry === "2026-08-20");
  const tomorrow = rows.find((r) => r.expiry === "2026-08-21");
  assert.equal(today?.dte, 0);
  assert.equal(today?.horizon, "0DTE");
  // The bigger, nearer-LOOKING row is the NEXT session — the exact confusion the field removes.
  assert.equal(tomorrow?.dte, 1);
  assert.equal(tomorrow?.horizon, "This week");
});

test("expiryConcentration falls back to ET-anchored daysToExpiry when the row has no dte", () => {
  // 2026-08-21T01:00Z is still 2026-08-20 in ET, so an 08-20 expiry is 0DTE, not -1/expired.
  const now = new Date("2026-08-21T01:00:00Z");
  const rows = expiryConcentration(
    [{ ...print({ dte: 0, premium: 1_000, expiry: "2026-08-20" }), dte: undefined }],
    8,
    now
  );
  assert.equal(rows[0]?.dte, 0);
  assert.equal(rows[0]?.horizon, "0DTE");
});

test("empty tape produces no horizons rather than a fabricated bucket", () => {
  assert.deepEqual(expiryHorizonConcentration([]), []);
});
