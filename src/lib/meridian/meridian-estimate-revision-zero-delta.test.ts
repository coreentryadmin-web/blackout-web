import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";

// Regression: `diffEstimateRevisionTimeline`'s revenue branch pushed a visible timeline entry
// whenever `row.estimated_revenue !== prev.estimated_revenue`, then computed `revenue_delta_pct`
// by rounding to 1 decimal for display. On a large revenue base (e.g. Zscaler's ~$958M), a real
// but tiny nudge (a few thousand dollars) rounds to "0.0" — the entry still got pushed, producing
// a live-confirmed headline of "ZS Rev est revised +0%" on `GET /api/market/meridian/timeline`.
// That reads as real news (a revision happened) while telling the member nothing actually moved,
// polluting the timeline meant to highlight material revisions. The fix skips emitting the entry
// when the ROUNDED delta is exactly 0, while still updating the snapshot so future diffs compare
// against the latest value instead of accumulating unreported drift.

mock.module("server-only", { namedExports: {} });

let cache = new Map<string, unknown>();

mock.module("../shared-cache", {
  namedExports: {
    sharedCacheGet: async (key: string) => cache.get(key) ?? null,
    sharedCacheSet: async (key: string, value: unknown) => {
      cache.set(key, value);
    },
  },
});

let diffEstimateRevisionTimeline: typeof import("./meridian-benzinga-analytics").diffEstimateRevisionTimeline;

test.before(async () => {
  const mod = await import("./meridian-benzinga-analytics");
  diffEstimateRevisionTimeline = mod.diffEstimateRevisionTimeline;
});

function row(partial: Partial<BenzingaStructuredEarnings>): BenzingaStructuredEarnings {
  return {
    benzinga_id: partial.benzinga_id ?? "1",
    ticker: partial.ticker ?? "ZS",
    company_name: partial.company_name ?? "Zscaler",
    currency: partial.currency ?? "USD",
    date: partial.date ?? "2027-02-25",
    time: partial.time ?? null,
    date_status: partial.date_status ?? "projected",
    importance: partial.importance ?? 4,
    estimated_eps: partial.estimated_eps ?? 0.97,
    estimated_revenue: partial.estimated_revenue ?? 957_933_672,
    fiscal_period: partial.fiscal_period ?? "Q2",
    fiscal_year: partial.fiscal_year ?? 2027,
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
    notes: partial.notes ?? null,
    last_updated: partial.last_updated ?? "2026-09-12T23:30:40.000Z",
  };
}

test("diffEstimateRevisionTimeline: a revenue nudge that rounds to 0.0% emits no visible entry", async () => {
  cache = new Map();
  const sinceIso = "2026-09-12T00:00:00.000Z";

  // First sighting seeds the snapshot, emits nothing (no actuals yet).
  const first = await diffEstimateRevisionTimeline([row({ estimated_revenue: 957_933_672 })], sinceIso);
  assert.equal(first.length, 0);

  // A real but tiny change (+$200k on a ~$958M base = 0.021%, rounds to "0.0").
  const second = await diffEstimateRevisionTimeline(
    [row({ estimated_revenue: 957_933_672 + 200_000, last_updated: "2026-09-13T01:00:00.000Z" })],
    sinceIso
  );
  assert.equal(second.length, 0, "a change that displays as +0.0% must not surface as a timeline entry");
});

test("diffEstimateRevisionTimeline: a revenue change that rounds to a nonzero pct still emits", async () => {
  cache = new Map();
  const sinceIso = "2026-09-12T00:00:00.000Z";

  await diffEstimateRevisionTimeline([row({ estimated_revenue: 957_933_672 })], sinceIso);

  // +5% is a real, material, correctly-surfaced revision.
  const second = await diffEstimateRevisionTimeline(
    [
      row({
        estimated_revenue: Math.round(957_933_672 * 1.05),
        last_updated: "2026-09-13T01:00:00.000Z",
      }),
    ],
    sinceIso
  );
  assert.equal(second.length, 1);
  assert.equal(second[0].change_kind, "revenue");
  assert.equal(second[0].revenue_delta_pct, 5);
  assert.equal(second[0].headline, "ZS Rev est revised +5%");
});
