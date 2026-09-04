import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";

mock.module("server-only", { namedExports: {} });

const TODAY = "2026-09-04";
const emptyBundle = {
  window_rows: [] as BenzingaStructuredEarnings[],
  entitled: true,
  error: null,
  earnings_week: [],
  earnings_analytics_rows: [],
  earnings_week_analytics: null,
  earnings_week_analytics_error: null,
  recent_revisions: [],
  estimate_revision_timeline: [],
  after_hours_movers: [],
};

let windowRows: BenzingaStructuredEarnings[] = [];
let emBatchTickers: string[] = [];

function benzingaRow(
  over: Partial<BenzingaStructuredEarnings> & Pick<BenzingaStructuredEarnings, "ticker" | "date">
): BenzingaStructuredEarnings {
  return {
    benzinga_id: `${over.ticker}:${over.date}`,
    company_name: over.ticker,
    currency: "USD",
    time: "16:20:00",
    date_status: "confirmed",
    importance: 4,
    estimated_eps: 1,
    estimated_revenue: null,
    fiscal_period: "Q2",
    fiscal_year: 2026,
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
    ...over,
  };
}

mock.module("./meridian-benzinga-earnings", {
  namedExports: {
    loadBenzingaEarningsBundle: async () => ({ ...emptyBundle, window_rows: windowRows }),
    loadBenzingaBoardEarnings: async () => ({ rows: [], entitled: true }),
  },
});

mock.module("../providers/unusual-whales", {
  namedExports: {
    fetchUwOptionableTickers: async () => ["NVDA", "AMD", "INTC"],
  },
});

mock.module("./meridian-earnings-expected-move", {
  namedExports: {
    batchLoadEarningsExpectedMovePct: async (
      items: Array<{ ticker: string; report_date: string }>
    ) => {
      emBatchTickers = items.map((i) => i.ticker);
      return {
        byTicker: new Map<string, number | null>(),
        coverage: {
          requested: items.length,
          attempted: 0,
          skipped: items.length,
          resolved: 0,
          note: null,
        },
      };
    },
  },
});

mock.module("./meridian-sector-classify", {
  namedExports: {
    classifyTickerSectors: async () => ({ byTicker: {} }),
  },
});

const mod = () => import("./meridian-timeline-server");

test("loadMeridianEarningsTimeline skips already-printed rows for the expected-move batch", async () => {
  windowRows = [
    benzingaRow({ ticker: "NVDA", date: TODAY, actual_eps: 1.25 }),
    benzingaRow({ ticker: "AMD", date: "2026-09-08" }),
    benzingaRow({ ticker: "INTC", date: "2026-09-10", actual_revenue: 12_000_000_000 }),
  ];
  emBatchTickers = [];

  const { loadMeridianEarningsTimeline } = await mod();
  const result = await loadMeridianEarningsTimeline(TODAY, 14);

  assert.deepEqual(emBatchTickers, ["AMD"], "printed rows must not consume the chain budget");
  assert.equal(result.rows.length, 3, "printed rows still appear in the lane");
  assert.equal(result.rows.find((r) => r.ticker === "NVDA")?.is_printed, true);
  assert.equal(result.rows.find((r) => r.ticker === "INTC")?.is_printed, true);
});
