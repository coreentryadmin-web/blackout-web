import assert from "node:assert/strict";
import { test } from "node:test";
import { fitHelixTapeAnalyticsForModel } from "@/lib/largo/helix-tape-analytics-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

test("fitHelixTapeAnalyticsForModel caps leaders and stays under budget", () => {
  const leaders = Array.from({ length: 15 }, (_, i) => ({
    ticker: `T${i}`,
    calls: 1_000_000,
    puts: 500_000,
    net: 500_000,
    total: 1_500_000,
    call_pct: 67,
    direction: "bullish",
    direction_readable_pct: 80,
    direction_minority_evidence: false,
    direction_basis: "aggressor",
  }));
  const raw = {
    available: true,
    session: { alert_count: 500, call_pct: 60, total_premium: 1e9 },
    window: { requested_hours: 168, actual_hours: 1.2, limit_reached: true },
    net_premium_leaders: leaders,
    route_breakdown: Array.from({ length: 12 }, (_, i) => ({
      route: `R${i}`,
      premium: 1e6,
      count: 10,
      pct: 8,
    })),
    expiry_concentration: Array.from({ length: 10 }, (_, i) => ({
      expiry: `2026-12-${String(i + 1).padStart(2, "0")}`,
      dte: 30 + i,
      horizon: "Monthly",
      premium: 5e6,
      count: 20,
      pct: 10,
    })),
    expiry_horizons: [{ horizon: "0DTE", premium: 1e6, count: 5, call_pct: 55 }],
  };
  const { fitted } = fitHelixTapeAnalyticsForModel(raw);
  assert.ok((fitted.net_premium_leaders as unknown[]).length <= 8);
  assert.equal(fitted.net_premium_leaders_truncated, true);
  assert.ok(JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET);
});
