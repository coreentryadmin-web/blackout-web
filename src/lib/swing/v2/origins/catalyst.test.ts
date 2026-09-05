import { test } from "node:test";
import assert from "node:assert/strict";
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";
import {
  scoreCatalystEarningsRowForSwing,
  screenCatalystFromEarningsRows,
} from "./catalyst";

function row(partial: Partial<BenzingaStructuredEarnings> & { ticker: string; date: string }): BenzingaStructuredEarnings {
  return {
    benzinga_id: null,
    company_name: null,
    currency: null,
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

test("scoreCatalystEarningsRowForSwing: admits upcoming print within 15d", () => {
  const hit = scoreCatalystEarningsRowForSwing(
    row({ ticker: "NVDA", date: "2026-09-10", importance: 4, date_status: "confirmed" }),
    "2026-09-05",
  );
  assert.ok(hit);
  assert.equal(hit!.kind, "PRE_EARNINGS");
  assert.equal(hit!.daysToEvent, 5);
});

test("scoreCatalystEarningsRowForSwing: rejects far-out low-importance print", () => {
  const hit = scoreCatalystEarningsRowForSwing(
    row({ ticker: "TINY", date: "2026-09-18", importance: 1 }),
    "2026-09-05",
  );
  assert.equal(hit, null);
});

test("scoreCatalystEarningsRowForSwing: admits recent post-earnings drift", () => {
  const hit = scoreCatalystEarningsRowForSwing(
    row({
      ticker: "AMD",
      date: "2026-09-01",
      actual_eps: 0.92,
      estimated_eps: 0.8,
      eps_surprise_pct: 0.15,
    }),
    "2026-09-05",
  );
  assert.ok(hit);
  assert.equal(hit!.kind, "POST_EARNINGS_DRIFT");
  assert.equal(hit!.daysToEvent, -4);
});

test("screenCatalystFromEarningsRows: dedupes by ticker keeping best score", () => {
  const hits = screenCatalystFromEarningsRows(
    [
      row({ ticker: "NVDA", date: "2026-09-10", importance: 2 }),
      row({ ticker: "NVDA", date: "2026-09-07", importance: 4, date_status: "confirmed" }),
      row({ ticker: "AMD", date: "2026-09-01", actual_eps: 1, estimated_eps: 0.9 }),
    ],
    "2026-09-05",
  );
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.ticker, "NVDA");
  assert.ok(hits[0]!.score >= hits[1]!.score);
});
