import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeShortVolume,
  normalizeShortVolumeRatio,
  normalizeShortInterest,
  assembleFundamentalsBundle,
} from "./ticker-fundamentals";
import type { PolygonFinancialRatios, FundamentalSignals } from "@/lib/providers/polygon";

test("normalizeShortVolumeRatio: percent-scale upstream values normalize to 0–1 fraction", () => {
  assert.ok(Math.abs(normalizeShortVolumeRatio(69.13)! - 0.6913) < 1e-9);
  assert.equal(normalizeShortVolumeRatio(0.42), 0.42);
  assert.equal(normalizeShortVolumeRatio(0), null);
});

test("summarizeShortVolume: percent-scale Polygon row normalizes before return", () => {
  const s = summarizeShortVolume([
    { date: "2026-07-10", short_volume: 6, total_volume: 10, short_volume_ratio: 69.13 },
  ]);
  assert.ok(Math.abs(s.short_volume_ratio! - 0.6913) < 1e-9);
});

test("summarizeShortVolume: picks the freshest row's ratio + date (bad sort tolerated)", () => {
  const s = summarizeShortVolume([
    { date: "2026-07-01", short_volume: 1, total_volume: 10, short_volume_ratio: 0.1 },
    { date: "2026-07-10", short_volume: 6, total_volume: 10, short_volume_ratio: 0.6 }, // newest, returned 2nd
    { date: "2026-06-15", short_volume: 3, total_volume: 10, short_volume_ratio: 0.3 },
  ]);
  assert.deepEqual(s, { short_volume_ratio: 0.6, short_volume_date: "2026-07-10" });
});

test("summarizeShortVolume: empty rows and zero ratio → null", () => {
  assert.deepEqual(summarizeShortVolume([]), { short_volume_ratio: null, short_volume_date: null });
  const z = summarizeShortVolume([{ date: "2026-07-10", short_volume: 0, total_volume: 0, short_volume_ratio: 0 }]);
  assert.equal(z.short_volume_ratio, null);
  assert.equal(z.short_volume_date, "2026-07-10");
});

test("normalizeShortInterest: maps real reading; 0-coerced numerics become null", () => {
  const si = normalizeShortInterest({
    ticker: "NVDA",
    settlement_date: "2026-06-30",
    short_interest: 12_000_000,
    avg_daily_volume: 3_000_000,
    days_to_cover: 4,
    source: "massive_stocks_v1",
  });
  assert.deepEqual(si, {
    settlement_date: "2026-06-30",
    short_interest: 12_000_000,
    avg_daily_volume: 3_000_000,
    days_to_cover: 4,
  });
});

test("normalizeShortInterest: null passthrough + all-empty reading → null", () => {
  assert.equal(normalizeShortInterest(null), null);
  const empty = normalizeShortInterest({
    ticker: "X",
    settlement_date: "",
    short_interest: 0,
    avg_daily_volume: 0,
    days_to_cover: 0,
    source: "massive_stocks_v1",
  });
  assert.equal(empty, null);
});

test("assembleFundamentalsBundle: as_of prefers ratios → signals → SI → short-vol; slices passthrough", () => {
  const ratios = { as_of: "2026-07-09", pe_ratio: 30 } as unknown as PolygonFinancialRatios;
  const signals = { latest_period_end: "2026-03-31" } as unknown as FundamentalSignals;

  const full = assembleFundamentalsBundle("nvda", {
    ratios,
    signals,
    priceTarget: null,
    shortInterest: { settlement_date: "2026-06-30", short_interest: 1, avg_daily_volume: 2, days_to_cover: 3 },
    shortVolume: { short_volume_ratio: 0.42, short_volume_date: "2026-07-10" },
  });
  assert.equal(full.ticker, "NVDA"); // uppercased
  assert.equal(full.as_of, "2026-07-09"); // ratios wins
  assert.equal(full.short_volume_ratio, 0.42);
  assert.equal(full.short_interest?.days_to_cover, 3);

  // No ratios → falls through to signals' period end.
  const noRatios = assembleFundamentalsBundle("nvda", {
    ratios: null,
    signals,
    priceTarget: null,
    shortInterest: null,
    shortVolume: { short_volume_ratio: null, short_volume_date: null },
  });
  assert.equal(noRatios.as_of, "2026-03-31");

  // Nothing dated anywhere → as_of null.
  const bare = assembleFundamentalsBundle("nvda", {
    ratios: null,
    signals: null,
    priceTarget: null,
    shortInterest: null,
    shortVolume: { short_volume_ratio: null, short_volume_date: null },
  });
  assert.equal(bare.as_of, null);
});

// BUG FIX (2026-11-09, Ask Largo standing mandate -- sibling of the 2026-11-08 earnings-leg fix,
// PR #7584 / commit 7df37da25): assembleFundamentalsBundle must thread shortInterestError/
// shortVolumeError through additively -- omitting them (the pre-existing call shape) must still
// produce `null`, not `undefined`, so a consumer's `=== null` / truthiness check behaves the same
// whether or not the caller passes the new fields.
test("assembleFundamentalsBundle: short_interest_error/short_volume_error default to null when omitted (no regression)", () => {
  const bundle = assembleFundamentalsBundle("nvda", {
    ratios: null,
    signals: null,
    priceTarget: null,
    shortInterest: null,
    shortVolume: { short_volume_ratio: null, short_volume_date: null },
  });
  assert.equal(bundle.short_interest_error, null);
  assert.equal(bundle.short_volume_error, null);
});

test("assembleFundamentalsBundle: a FAILED short-interest fetch carries the real error through, independent of short-volume", () => {
  const bundle = assembleFundamentalsBundle("tsla", {
    ratios: null,
    signals: null,
    priceTarget: null,
    shortInterest: null,
    shortVolume: { short_volume_ratio: 0.42, short_volume_date: "2026-11-07" },
    shortInterestError: "Polygon /stocks/v1/short-interest → 403",
  });
  assert.equal(bundle.short_interest_error, "Polygon /stocks/v1/short-interest → 403");
  assert.equal(bundle.short_volume_error, null, "the sibling short-volume leg succeeded and must carry no spurious error");
  // The short-volume leg still succeeded, so the bundle still carries real data -- only the
  // short-interest leg's own slice is missing, and now for a NAMED reason.
  assert.equal(bundle.short_volume_ratio, 0.42);
});

test("assembleFundamentalsBundle: a FAILED short-volume fetch carries the real error through, independent of short-interest", () => {
  const bundle = assembleFundamentalsBundle("mstr", {
    ratios: null,
    signals: null,
    priceTarget: null,
    shortInterest: { settlement_date: "2026-10-31", short_interest: 1, avg_daily_volume: 2, days_to_cover: 3 },
    shortVolume: { short_volume_ratio: null, short_volume_date: null },
    shortVolumeError: "Polygon /stocks/v1/short-volume → 429 (rate limited)",
  });
  assert.equal(bundle.short_volume_error, "Polygon /stocks/v1/short-volume → 429 (rate limited)");
  assert.equal(bundle.short_interest_error, null);
  assert.equal(bundle.short_interest?.days_to_cover, 3);
});

test("assembleFundamentalsBundle: BOTH legs failing together carry both real errors independently", () => {
  const bundle = assembleFundamentalsBundle("mstr", {
    ratios: null,
    signals: null,
    priceTarget: null,
    shortInterest: null,
    shortVolume: { short_volume_ratio: null, short_volume_date: null },
    shortInterestError: "Polygon /stocks/v1/short-interest → 403",
    shortVolumeError: "Polygon /stocks/v1/short-volume → 403",
  });
  assert.equal(bundle.short_interest_error, "Polygon /stocks/v1/short-interest → 403");
  assert.equal(bundle.short_volume_error, "Polygon /stocks/v1/short-volume → 403");
});
