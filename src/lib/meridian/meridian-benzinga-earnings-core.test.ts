import test from "node:test";
import assert from "node:assert/strict";
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";
import {
  benzingaSurpriseToDisplayPct,
  buildRecentEarningsRevisions,
  computeEarningsYoY,
  dualBeatRateFromPrints,
  earningsWhenFromTime,
  mergeEarningsTimelineSources,
  mergeStreetEstimates,
  pickEarningsCalendarRow,
  postPrintSurpriseLean,
} from "./meridian-benzinga-earnings-core.ts";

function bz(partial: Partial<BenzingaStructuredEarnings> & Pick<BenzingaStructuredEarnings, "ticker" | "date">) {
  return {
    benzinga_id: partial.benzinga_id ?? `${partial.ticker}:${partial.date}`,
    company_name: partial.company_name ?? partial.ticker,
    time: partial.time ?? null,
    date_status: partial.date_status ?? "confirmed",
    importance: partial.importance ?? 5,
    estimated_eps: partial.estimated_eps ?? null,
    estimated_revenue: partial.estimated_revenue ?? null,
    fiscal_period: partial.fiscal_period ?? "Q2",
    fiscal_year: partial.fiscal_year ?? 2026,
    actual_eps: partial.actual_eps ?? null,
    actual_revenue: partial.actual_revenue ?? null,
    eps_surprise: partial.eps_surprise ?? null,
    eps_surprise_pct: partial.eps_surprise_pct ?? null,
    revenue_surprise: partial.revenue_surprise ?? null,
    revenue_surprise_pct: partial.revenue_surprise_pct ?? null,
    previous_eps: partial.previous_eps ?? null,
    previous_revenue: partial.previous_revenue ?? null,
    eps_method: partial.eps_method ?? null,
    revenue_method: partial.revenue_method ?? null,
    currency: partial.currency ?? "USD",
    notes: partial.notes ?? null,
    last_updated: partial.last_updated ?? null,
    ...partial,
  } satisfies BenzingaStructuredEarnings;
}

test("earningsWhenFromTime buckets pre/post market", () => {
  assert.equal(earningsWhenFromTime("08:30:00"), "premarket");
  assert.equal(earningsWhenFromTime("16:20:00"), "afterhours");
  assert.equal(earningsWhenFromTime(null), null);
});

test("benzingaSurpriseToDisplayPct normalizes ratio to percent", () => {
  assert.equal(benzingaSurpriseToDisplayPct(0.0625), 6.3);
  assert.equal(benzingaSurpriseToDisplayPct(6.25), 6.3);
});

test("mergeEarningsTimelineSources overlays UW expected move on Benzinga row", () => {
  const merged = mergeEarningsTimelineSources(
    [bz({ ticker: "NVDA", company_name: "NVIDIA", date: "2026-08-26", time: "16:20:00" })],
    [
      {
        ticker: "NVDA",
        name: "NVDA",
        report_date: "2026-08-26",
        when: "afterhours",
        expected_move_pct: 6.2,
        source: "uw_grid",
      },
    ]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.name, "NVIDIA");
  assert.equal(merged[0]?.expected_move_pct, 6.2);
  assert.equal(merged[0]?.report_time, "16:20");
});

test("mergeEarningsTimelineSources drops stale UW-only date when Benzinga confirmed differs", () => {
  const merged = mergeEarningsTimelineSources(
    [bz({ ticker: "NVDA", date: "2026-08-26", date_status: "confirmed" })],
    [
      {
        ticker: "NVDA",
        name: "NVDA",
        report_date: "2026-08-20",
        when: "afterhours",
        expected_move_pct: 5,
        source: "uw_grid",
      },
    ]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.report_date, "2026-08-26");
});

test("mergeStreetEstimates prefers Benzinga then UW tail", () => {
  const merged = mergeStreetEstimates(
    [bz({ ticker: "NVDA", date: "2026-08-26", estimated_eps: 2.07, estimated_revenue: 9e10, fiscal_year: 2027 })],
    [{ period: "Q1 FY26", eps_estimate: 1.9, revenue_estimate: 8e10, source: "uw" }]
  );
  assert.equal(merged[0]?.source, "earnings_calendar");
  assert.equal(merged[0]?.eps_estimate, 2.07);
});

test("pickEarningsCalendarRow selects event date", () => {
  const row = pickEarningsCalendarRow(
    [bz({ ticker: "NVDA", date: "2026-08-26", estimated_eps: 2.07, previous_eps: 1.04 })],
    "2026-08-26"
  );
  assert.equal(row?.estimated_eps, 2.07);
  assert.equal(row?.previous_eps, 1.04);
});

test("computeEarningsYoY from estimate vs prior", () => {
  const yoy = computeEarningsYoY(bz({ ticker: "NVDA", date: "2026-08-26", estimated_eps: 1.2, previous_eps: 1.0 }));
  assert.equal(yoy?.eps_yoy_pct, 20);
});

test("dualBeatRateFromPrints grades eps and revenue beats", () => {
  const rates = dualBeatRateFromPrints([
    { report_date: "2026-05-01", beat: true, revenue_surprise_pct: 2, surprise_pct: 3 } as never,
    { report_date: "2026-02-01", beat: false, revenue_surprise_pct: -1, surprise_pct: -2 } as never,
  ]);
  assert.equal(rates.eps_beat_rate, 0.5);
  assert.equal(rates.revenue_beat_rate, 0.5);
});

test("postPrintSurpriseLean scores beat and miss", () => {
  const beat = postPrintSurpriseLean({
    is_printed: true,
    eps_surprise_pct: 4.2,
    revenue_surprise_pct: 1.1,
  } as never);
  assert.equal(beat.lean, "beat");
  assert.equal(beat.score, 2);

  const miss = postPrintSurpriseLean({
    is_printed: true,
    eps_surprise_pct: -3,
    revenue_surprise_pct: null,
  } as never);
  assert.equal(miss.lean, "miss");
  assert.equal(miss.score, -2);
});

test("buildRecentEarningsRevisions filters by last_updated window", () => {
  const rows = buildRecentEarningsRevisions(
    [
      bz({
        ticker: "META",
        date: "2026-08-20",
        last_updated: "2026-08-17T12:00:00Z",
        estimated_eps: 5.1,
      }),
      bz({
        ticker: "NVDA",
        date: "2026-08-26",
        last_updated: "2026-08-10T12:00:00Z",
        estimated_eps: 2.07,
      }),
    ],
    "2026-08-16T00:00:00Z"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.ticker, "META");
});
