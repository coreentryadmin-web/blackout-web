import assert from "node:assert/strict";
import test from "node:test";
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";
import {
  buildEarningsWeekAnalytics,
  buildStreetSkewFromPriceTargets,
  diffEstimateRevisionTimeline,
  mergeEstimateRevisionTimeline,
  surpriseDistributionFromRows,
} from "./meridian-benzinga-analytics";
import type {
  MeridianEarningsWeekRow,
  MeridianEstimateRevisionEntry,
} from "@/features/meridian/lib/meridian-types";

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

function revisionEntry(partial: Partial<MeridianEstimateRevisionEntry>): MeridianEstimateRevisionEntry {
  return {
    ticker: partial.ticker ?? "NVDA",
    company_name: partial.company_name ?? "NVIDIA",
    date: partial.date ?? "2026-08-20",
    last_updated: partial.last_updated ?? "2026-08-18T14:52:00.000Z",
    change_kind: partial.change_kind ?? "eps",
    eps_delta: partial.eps_delta ?? null,
    revenue_delta_pct: partial.revenue_delta_pct ?? null,
    estimated_eps: partial.estimated_eps ?? null,
    estimated_revenue: partial.estimated_revenue ?? null,
    headline: partial.headline ?? "NVDA EPS est 1.0 → 1.1",
  };
}

test("mergeEstimateRevisionTimeline: a build with no live diff still shows persisted history", () => {
  // Reproduces the exact FINDINGS 2026-08-18 measurement: 4 entries detected at 14:52 UTC, then
  // 0 live entries at 14:57 UTC because the Redis snapshot the diff compares against had already
  // advanced. Without the merge, the 14:57 build would serve an empty panel.
  const persisted = [
    revisionEntry({ ticker: "NVDA", last_updated: "2026-08-18T14:52:00.000Z" }),
    revisionEntry({ ticker: "TSLA", last_updated: "2026-08-18T14:51:00.000Z" }),
  ];
  const merged = mergeEstimateRevisionTimeline([], persisted);
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((e) => e.ticker),
    ["NVDA", "TSLA"]
  );
});

test("mergeEstimateRevisionTimeline: same revision from live and persisted counts once", () => {
  const live = [revisionEntry({ ticker: "NVDA", last_updated: "2026-08-18T14:52:00.000Z" })];
  const persisted = [revisionEntry({ ticker: "NVDA", last_updated: "2026-08-18T14:52:00.000Z" })];
  const merged = mergeEstimateRevisionTimeline(live, persisted);
  assert.equal(merged.length, 1);
});

test("diffEstimateRevisionTimeline: emits a revenue 'estimate set' entry on first sighting, same as EPS", async () => {
  // Reproduces the asymmetric-guard gap: the EPS branch emits a "set" revision the first time an
  // estimate appears for a print (prev snapshot had no estimate, no actual yet); the revenue
  // branch had no equivalent, so the identical first-appearance case for revenue silently updated
  // the snapshot with no member-visible timeline entry. ticker is fixed across both calls (same
  // Redis/in-memory snapshot key) so the second call reads the first call's persisted snapshot.
  //
  // Built directly (not via the shared `earningsRow` helper above) because that helper's `??`
  // defaults — e.g. `estimated_eps: partial.estimated_eps ?? 1.0` — silently coerce an explicit
  // `null` override back to the default, making it impossible to seed a genuinely-null prior
  // estimate through it.
  function benzingaRow(overrides: Partial<BenzingaStructuredEarnings>): BenzingaStructuredEarnings {
    return {
      benzinga_id: "1",
      ticker: "RVSET",
      company_name: "Rev Set Co",
      date: "2026-08-20",
      date_status: "confirmed",
      importance: 5,
      estimated_eps: null,
      estimated_revenue: null,
      actual_eps: null,
      actual_revenue: null,
      eps_surprise: null,
      eps_surprise_pct: null,
      revenue_surprise_pct: null,
      previous_eps: null,
      fiscal_period: "Q2",
      fiscal_year: 2026,
      report_time: null,
      last_updated: "2026-08-17T12:00:00Z",
      ...overrides,
    };
  }

  const ticker = `RVSET${Date.now()}`;
  const since = "2026-08-18T00:00:00.000Z";

  // First sighting: no prior snapshot at all (neither EPS nor revenue estimate yet) — seeds the
  // snapshot only, emits nothing (existing, correct behavior for a totally fresh row).
  const seedRow = benzingaRow({ ticker, last_updated: "2026-08-18T12:00:00.000Z" });
  const seeded = await diffEstimateRevisionTimeline([seedRow], since);
  assert.equal(seeded.length, 0);

  // Second sighting: Benzinga has now published BOTH an EPS estimate and a revenue estimate for
  // the first time, with no actual yet. EPS already got a "set" entry before this fix; revenue
  // must get one too.
  const row = benzingaRow({
    ticker,
    estimated_eps: 1.0,
    estimated_revenue: 5_000_000_000,
    last_updated: "2026-08-18T13:00:00.000Z",
  });
  const revisions = await diffEstimateRevisionTimeline([row], since);

  const epsSet = revisions.find((r) => r.change_kind === "eps");
  const revenueSet = revisions.find((r) => r.change_kind === "revenue");
  assert.ok(epsSet, "expected an EPS 'estimate set' entry (pre-existing behavior)");
  assert.ok(revenueSet, "expected a revenue 'estimate set' entry mirroring the EPS one");
  assert.equal(revenueSet!.headline, `${ticker} Rev est set · 5000000000`);
});

test("mergeEstimateRevisionTimeline: sorts newest-first across both sources and respects limit", () => {
  const live = [revisionEntry({ ticker: "AAPL", last_updated: "2026-08-18T15:00:00.000Z" })];
  const persisted = [
    revisionEntry({ ticker: "NVDA", last_updated: "2026-08-18T14:52:00.000Z" }),
    revisionEntry({ ticker: "TSLA", last_updated: "2026-08-18T14:00:00.000Z" }),
  ];
  const merged = mergeEstimateRevisionTimeline(live, persisted, 2);
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((e) => e.ticker),
    ["AAPL", "NVDA"]
  );
});
