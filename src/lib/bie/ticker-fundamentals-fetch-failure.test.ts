import assert from "node:assert/strict";
import { test, mock, before, beforeEach } from "node:test";

// REAL BEHAVIOR test for fetchTickerFundamentalsBundle's failure-vs-absence wiring -- mocking
// ../providers/polygon / ../providers/config / ../server-cache per node:test's
// --experimental-test-module-mocks so the actual Promise.all + assembleFundamentalsBundle wiring
// runs for real, not just a regex check against the source. Kept in its OWN file (not
// ticker-fundamentals.test.ts, which statically imports pure helpers at module top level) because
// mock.module() must run before anything resolves ticker-fundamentals.ts's dependency graph --
// same established pattern as polygon-macro-fetch-failure.test.ts / meridian-benzinga-earnings.test.ts.
//
// BUG FIX (2026-11-09, Ask Largo standing mandate -- sibling of the 2026-11-08 earnings-leg fix,
// PR #7584 / commit 7df37da25): fetchTickerFundamentalsBundle used to call
// fetchShortInterest(sym).catch(() => null) / fetchShortVolume(sym, 5).catch(() => []), which
// swallowed a failed fetch into the exact same shape as a genuine empty read. It now calls the
// *Result wrappers and threads their error through to the bundle's short_interest_error/
// short_volume_error fields -- this proves that end-to-end wiring, not just the pure assembler.

mock.module("../server-cache", {
  namedExports: {
    // Bypass the real cache entirely so each test observes this call's own return value, not a
    // previous run's cached result -- same pattern as meridian-benzinga-earnings.test.ts.
    serverCache: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    TTL: { REFERENCE: 3_600_000 },
  },
});

mock.module("../providers/config", {
  namedExports: {
    polygonConfigured: () => true,
  },
});

type ResultOutcome<T> = { value: T };

let shortInterestResultOutcome: ResultOutcome<{ row: unknown; error: string | null }> = {
  value: { row: null, error: null },
};
let shortVolumeResultOutcome: ResultOutcome<{ rows: unknown[]; error: string | null }> = {
  value: { rows: [], error: null },
};

mock.module("../providers/polygon", {
  namedExports: {
    fetchPolygonFinancialRatios: async () => null,
    fetchPolygonIncomeStatements: async () => [],
    fetchPolygonBalanceSheets: async () => [],
    fetchPolygonCashFlowStatements: async () => [],
    computeFundamentalSignals: () => null,
    fetchBenzingaPriceTarget: async () => null,
    // fetchShortInterest itself is unused by the fix (only its TYPE is referenced by
    // normalizeShortInterest) but ticker-fundamentals.ts still imports the real binding, so the
    // mock must export SOMETHING callable under this name too.
    fetchShortInterest: async () => null,
    fetchShortInterestResult: async () => shortInterestResultOutcome.value,
    fetchShortVolumeResult: async () => shortVolumeResultOutcome.value,
  },
});

let fetchTickerFundamentalsBundle: typeof import("./ticker-fundamentals").fetchTickerFundamentalsBundle;

before(async () => {
  ({ fetchTickerFundamentalsBundle } = await import("./ticker-fundamentals"));
});

beforeEach(() => {
  shortInterestResultOutcome = { value: { row: null, error: null } };
  shortVolumeResultOutcome = { value: { rows: [], error: null } };
});

test("fetchTickerFundamentalsBundle: a genuine empty-but-successful read carries short_interest_error/short_volume_error as null (no regression)", async () => {
  const bundle = await fetchTickerFundamentalsBundle("ZZZZ");
  assert.ok(bundle);
  assert.equal(bundle?.short_interest, null);
  assert.equal(bundle?.short_volume_ratio, null);
  assert.equal(bundle?.short_interest_error, null);
  assert.equal(bundle?.short_volume_error, null);
});

test("fetchTickerFundamentalsBundle: a FAILED short-interest fetch carries the real error into the bundle", async () => {
  shortInterestResultOutcome = { value: { row: null, error: "Polygon /stocks/v1/short-interest → 403" } };
  const bundle = await fetchTickerFundamentalsBundle("TSLA");
  assert.ok(bundle);
  assert.equal(bundle?.short_interest, null, "still no row to show -- the fetch failed");
  assert.match(
    bundle?.short_interest_error ?? "",
    /403/,
    `expected the real failure to reach the bundle, got: ${bundle?.short_interest_error}`,
  );
  assert.equal(bundle?.short_volume_error, null, "the sibling leg did not fail and must carry no spurious error");
});

test("fetchTickerFundamentalsBundle: a FAILED short-volume fetch carries the real error into the bundle", async () => {
  shortVolumeResultOutcome = { value: { rows: [], error: "Polygon /stocks/v1/short-volume → 429 (rate limited)" } };
  const bundle = await fetchTickerFundamentalsBundle("MSTR");
  assert.ok(bundle);
  assert.equal(bundle?.short_volume_ratio, null);
  assert.match(bundle?.short_volume_error ?? "", /429/);
  assert.equal(bundle?.short_interest_error, null);
});

test("fetchTickerFundamentalsBundle: BOTH legs failing together carry both real errors independently into the same bundle", async () => {
  shortInterestResultOutcome = { value: { row: null, error: "Polygon /stocks/v1/short-interest → 403" } };
  shortVolumeResultOutcome = { value: { rows: [], error: "Polygon /stocks/v1/short-volume → 403" } };
  const bundle = await fetchTickerFundamentalsBundle("MSTR");
  assert.ok(bundle);
  assert.match(bundle?.short_interest_error ?? "", /403/);
  assert.match(bundle?.short_volume_error ?? "", /403/);
});

test("fetchTickerFundamentalsBundle: a real successful short-interest row still parses correctly (no regression)", async () => {
  shortInterestResultOutcome = {
    value: {
      row: { settlement_date: "2026-10-31", short_interest: 100, avg_daily_volume: 5_000_000, days_to_cover: 0.02 },
      error: null,
    },
  };
  const bundle = await fetchTickerFundamentalsBundle("AAPL");
  assert.ok(bundle);
  assert.equal(bundle?.short_interest?.days_to_cover, 0.02);
  assert.equal(bundle?.short_interest_error, null);
});
