import assert from "node:assert/strict";
import test from "node:test";
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";
import {
  buildEarningsWeekAnalytics,
  buildStreetSkewFromPriceTargets,
  surpriseDistributionFromRows,
} from "./meridian-benzinga-analytics";
import type { MeridianEarningsWeekRow } from "@/features/meridian/lib/meridian-types";

function earningsRow(partial: Partial<BenzingaStructuredEarnings>): BenzingaStructuredEarnings {
  return {
    benzinga_id: partial.benzinga_id ?? "1",
    ticker: partial.ticker ?? "NVDA",
    company_name: partial.company_name ?? "NVIDIA",
    date: partial.date ?? "2026-08-20",
    date_status: partial.date_status ?? "confirmed",
    importance: partial.importance ?? 5,
    estimated_eps: partial.estimated_eps ?? 1.0,
    estimated_revenue: partial.estimated_revenue ?? null,
    actual_eps: partial.actual_eps ?? null,
    actual_revenue: partial.actual_revenue ?? null,
    eps_surprise: partial.eps_surprise ?? null,
    eps_surprise_pct: partial.eps_surprise_pct ?? null,
    revenue_surprise_pct: partial.revenue_surprise_pct ?? null,
    previous_eps: partial.previous_eps ?? null,
    fiscal_period: partial.fiscal_period ?? "Q2",
    fiscal_year: partial.fiscal_year ?? 2026,
    report_time: partial.report_time ?? null,
    last_updated: partial.last_updated ?? "2026-08-17T12:00:00Z",
  };
}

test("buildStreetSkewFromPriceTargets: raised vs lowered net skew", () => {
  const skew = buildStreetSkewFromPriceTargets([
    { price_target: 200, firm: "Goldman", action: "raised", summary: "", published: "", url: "" },
    { price_target: 210, firm: "MS", action: "raised", summary: "", published: "", url: "" },
    { price_target: 220, firm: "JPM", action: "raised", summary: "", published: "", url: "" },
    { price_target: 180, firm: "Citi", action: "lowered", summary: "", published: "", url: "" },
  ]);
  assert.equal(skew?.skew, "bullish");
  assert.equal(skew?.raised_count, 3);
  assert.equal(skew?.lowered_count, 1);
});

test("buildEarningsWeekAnalytics: aggregates beat rate from historical prints", () => {
  const week: MeridianEarningsWeekRow[] = [
    {
      ticker: "NVDA",
      company_name: "NVIDIA",
      date: "2026-08-20",
      time_et: "16:20",
      importance: 5,
      date_status: "confirmed",
      estimated_eps: 1.0,
      is_printed: false,
    },
  ];
  const hist = [
    earningsRow({ actual_eps: 1.2, estimated_eps: 1.0, eps_surprise_pct: 20 }),
    earningsRow({ date: "2026-05-20", actual_eps: 0.9, estimated_eps: 1.0, eps_surprise_pct: -10 }),
  ];
  const analytics = buildEarningsWeekAnalytics(week, hist);
  assert.ok(analytics);
  assert.equal(analytics!.names_count, 1);
  assert.equal(analytics!.eps_beat_rate, 0.5);
});

test("surpriseDistributionFromRows: counts beats and misses", () => {
  const rows = [
    earningsRow({ actual_eps: 1.1, eps_surprise_pct: 5 }),
    earningsRow({ actual_eps: 0.8, eps_surprise_pct: -3 }),
  ];
  const dist = surpriseDistributionFromRows(rows);
  assert.equal(dist.beat_count, 1);
  assert.equal(dist.miss_count, 1);
  assert.equal(dist.avg_eps_surprise_pct, 1);
});
