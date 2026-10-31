import { test } from "node:test";
import assert from "node:assert/strict";
import { pickUpcomingEarningsRow } from "./meridian-ticker-lookup-core";
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";

function row(partial: Partial<BenzingaStructuredEarnings>): BenzingaStructuredEarnings {
  return {
    benzinga_id: null,
    ticker: "AAPL",
    company_name: null,
    currency: null,
    date: "2026-10-31",
    time: null,
    date_status: null,
    importance: null,
    estimated_eps: null,
    estimated_revenue: null,
    fiscal_period: null,
    fiscal_year: null,
    actual_eps: null,
    actual_revenue: null,
    eps_surprise: null,
    eps_surprise_pct: null,
    revenue_surprise: null,
    revenue_surprise_pct: null,
    previous_eps: null,
    previous_revenue: null,
    eps_method: null,
    revenue_method: null,
    notes: null,
    last_updated: null,
    ...partial,
  };
}

test("pickUpcomingEarningsRow picks the first not-yet-reported row", () => {
  const rows = [
    row({ date: "2026-10-31", actual_eps: null }),
    row({ date: "2027-01-28", actual_eps: null }),
  ];
  const picked = pickUpcomingEarningsRow(rows, "2026-10-31");
  assert.equal(picked?.date, "2026-10-31");
});

test("pickUpcomingEarningsRow skips an already-reported today row and finds the real next one", () => {
  const rows = [
    row({ date: "2026-10-31", actual_eps: 1.64 }), // reported this morning (BMO)
    row({ date: "2027-01-28", actual_eps: null }),
  ];
  const picked = pickUpcomingEarningsRow(rows, "2026-10-31");
  assert.equal(picked?.date, "2027-01-28");
});

test(
  "pickUpcomingEarningsRow returns null, NOT the stale already-reported row, when every " +
    "candidate row has already reported (the live bug: next quarter's date isn't calendared " +
    "yet, so the only row on file is today's already-released print)",
  () => {
    const rows = [row({ date: "2026-10-31", actual_eps: 1.64 })];
    const picked = pickUpcomingEarningsRow(rows, "2026-10-31");
    assert.equal(
      picked,
      null,
      "an already-reported row must never be reported back out as 'upcoming'"
    );
  }
);

test("pickUpcomingEarningsRow returns null when given no rows at all", () => {
  assert.equal(pickUpcomingEarningsRow([], "2026-10-31"), null);
});

test("pickUpcomingEarningsRow re-checks the date floor defensively (never trusts the caller's own dateGte filter blindly)", () => {
  const rows = [
    row({ date: "2026-10-01", actual_eps: null }), // stale, before `today` — must be skipped
    row({ date: "2026-10-31", actual_eps: null }),
  ];
  const picked = pickUpcomingEarningsRow(rows, "2026-10-31");
  assert.equal(picked?.date, "2026-10-31");
});
