import test from "node:test";
import assert from "node:assert/strict";
import {
  earningsWhenFromTime,
  mergeBenzingaTimelineRows,
  mergeStreetEstimates,
  pickEarningsCalendarRow,
} from "./meridian-benzinga-earnings-core.ts";

test("earningsWhenFromTime buckets pre/post market", () => {
  assert.equal(earningsWhenFromTime("08:30:00"), "premarket");
  assert.equal(earningsWhenFromTime("16:20:00"), "afterhours");
  assert.equal(earningsWhenFromTime(null), null);
});

test("mergeBenzingaTimelineRows adds missing tickers and enriches names", () => {
  const existing = new Map([
    [
      "NVDA",
      {
        ticker: "NVDA",
        name: "NVDA",
        report_date: "2026-08-26",
        when: "afterhours" as const,
        expected_move_pct: 6.2,
      },
    ],
  ]);
  const merged = mergeBenzingaTimelineRows(existing, [
    {
      ticker: "NVDA",
      company_name: "NVIDIA",
      date: "2026-08-26",
      time: "16:20:00",
      date_status: "confirmed",
      importance: 5,
      estimated_eps: 2.07,
      estimated_revenue: 9e10,
      fiscal_period: "Q2",
      fiscal_year: 2027,
      actual_eps: null,
      actual_revenue: null,
      eps_surprise_pct: null,
      revenue_surprise_pct: null,
      previous_eps: null,
      previous_revenue: null,
    },
    {
      ticker: "META",
      company_name: "Meta Platforms",
      date: "2026-08-20",
      time: "16:05:00",
      date_status: "confirmed",
      importance: 5,
      estimated_eps: 5.1,
      estimated_revenue: 4e10,
      fiscal_period: "Q2",
      fiscal_year: 2026,
      actual_eps: null,
      actual_revenue: null,
      eps_surprise_pct: null,
      revenue_surprise_pct: null,
      previous_eps: null,
      previous_revenue: null,
    },
  ]);
  assert.equal(merged.get("NVDA")?.name, "NVIDIA");
  assert.equal(merged.get("NVDA")?.expected_move_pct, 6.2);
  assert.equal(merged.get("META")?.report_date, "2026-08-20");
});

test("mergeStreetEstimates prefers Benzinga then UW tail", () => {
  const merged = mergeStreetEstimates(
    [
      {
        ticker: "NVDA",
        company_name: "NVIDIA",
        date: "2026-08-26",
        time: null,
        date_status: "confirmed",
        importance: 5,
        estimated_eps: 2.07,
        estimated_revenue: 9e10,
        fiscal_period: "Q2",
        fiscal_year: 2027,
        actual_eps: null,
        actual_revenue: null,
        eps_surprise_pct: null,
        revenue_surprise_pct: null,
        previous_eps: null,
        previous_revenue: null,
      },
    ],
    [{ period: "Q1 FY26", eps_estimate: 1.9, revenue_estimate: 8e10, source: "uw" }]
  );
  assert.equal(merged[0]?.source, "earnings_calendar");
  assert.equal(merged[0]?.eps_estimate, 2.07);
});

test("pickEarningsCalendarRow selects event date", () => {
  const row = pickEarningsCalendarRow(
    [
      {
        ticker: "NVDA",
        company_name: "NVIDIA",
        date: "2026-08-26",
        time: "16:20:00",
        date_status: "confirmed",
        importance: 5,
        estimated_eps: 2.07,
        estimated_revenue: null,
        fiscal_period: "Q2",
        fiscal_year: 2027,
        actual_eps: null,
        actual_revenue: null,
        eps_surprise_pct: null,
        revenue_surprise_pct: null,
        previous_eps: 1.04,
        previous_revenue: null,
      },
    ],
    "2026-08-26"
  );
  assert.equal(row?.estimated_eps, 2.07);
  assert.equal(row?.previous_eps, 1.04);
});
