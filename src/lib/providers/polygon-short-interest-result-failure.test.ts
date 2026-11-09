import assert from "node:assert/strict";
import { test, mock, before, beforeEach } from "node:test";

// REAL BEHAVIOR test for fetchShortInterestResult/fetchShortVolumeResult's failure-vs-absence
// distinction -- mocking polygon-rate-limiter/config per node:test's --experimental-test-module-mocks
// so the actual try/catch + Result-threading logic runs for real, not just a regex check against
// the source. Kept in its OWN file (not polygon-short-interest-absence.test.ts, which statically
// imports pure helpers at module top level) because mock.module() must run before anything resolves
// polygon.ts's dependency graph -- same established pattern as polygon-macro-fetch-failure.test.ts /
// meridian-benzinga-earnings.test.ts.
//
// BUG FIX (2026-11-09, Ask Largo standing mandate -- sibling of the 2026-11-08 earnings-leg fix,
// PR #7584 / commit 7df37da25): fetchShortInterest/fetchShortVolume's pre-existing "never throw,
// resolve null/[] on any miss" contract collapsed "the provider genuinely has no short-interest
// series for this ticker" and "the fetch itself failed" (a 403 not-entitled, a timeout, a rate
// limit -- see CLAUDE.md's live, currently-open "ENTITLEMENT REGRESSED 2026-11-07" note) into the
// identical miss, which ecosystem-context.ts's fundamentals/short-interest leg then read as
// confident proof of permanent structural absence for live names like TSLA/MSTR. The new
// fetchShortInterestResult/fetchShortVolumeResult wrappers surface the real outcome additively;
// these tests pin the RED->GREEN proof AND that fetchShortInterest/fetchShortVolume themselves are
// completely unaffected (same behavior, same existing callers: dossier.ts, run-tool.ts).

process.env.POLYGON_API_KEY = "test-polygon-key";
process.env.POLYGON_API_BASE = "https://api.massive.com";

type FetchOutcome =
  | { kind: "ok"; results: Array<Record<string, unknown>> }
  | { kind: "fail"; status: number };

const REAL_SHORT_INTEREST_ROW = {
  settlement_date: "2026-10-15",
  short_interest: 42_000,
  avg_daily_volume: 5_000_000,
  days_to_cover: 0.0084,
};
const REAL_SHORT_VOLUME_ROW = { date: "2026-10-15", short_volume: 100, total_volume: 1000, short_volume_ratio: 0.1 };

let shortInterestOutcome: FetchOutcome = { kind: "ok", results: [REAL_SHORT_INTEREST_ROW] };
let shortVolumeOutcome: FetchOutcome = { kind: "ok", results: [REAL_SHORT_VOLUME_ROW] };

// Relative specifier, not the "@/..." alias -- tsx's alias rewrite only applies to statically-
// parsed top-level `import ... from` statements, not to mock.module()'s specifier string.
mock.module("./polygon-rate-limiter", {
  namedExports: {
    polygonTrackedFetch: async (_endpointKey: string, url: string): Promise<Response> => {
      const outcome = url.includes("/stocks/v1/short-interest") ? shortInterestOutcome : shortVolumeOutcome;
      if (outcome.kind === "fail") {
        return { status: outcome.status, ok: false, json: async () => ({}) } as Response;
      }
      return { status: 200, ok: true, json: async () => ({ results: outcome.results }) } as Response;
    },
  },
});

mock.module("./config", {
  namedExports: {
    polygonConfigured: () => true,
  },
});

let fetchShortInterest: typeof import("./polygon").fetchShortInterest;
let fetchShortInterestResult: typeof import("./polygon").fetchShortInterestResult;
let fetchShortVolume: typeof import("./polygon").fetchShortVolume;
let fetchShortVolumeResult: typeof import("./polygon").fetchShortVolumeResult;

before(async () => {
  ({ fetchShortInterest, fetchShortInterestResult, fetchShortVolume, fetchShortVolumeResult } = await import(
    "./polygon"
  ));
});

beforeEach(() => {
  shortInterestOutcome = { kind: "ok", results: [REAL_SHORT_INTEREST_ROW] };
  shortVolumeOutcome = { kind: "ok", results: [REAL_SHORT_VOLUME_ROW] };
});

test("fetchShortInterestResult: a genuine successful-empty fetch returns {row: null, error: null} -- unchanged absence", async () => {
  shortInterestOutcome = { kind: "ok", results: [] };
  const result = await fetchShortInterestResult("ZZZZ");
  assert.equal(result.row, null);
  assert.equal(result.error, null);
});

test("fetchShortInterestResult: a FAILED fetch (403 not-entitled) carries the real error, not a bare null", async () => {
  shortInterestOutcome = { kind: "fail", status: 403 };
  const result = await fetchShortInterestResult("TSLA");
  assert.equal(result.row, null);
  assert.match(
    result.error ?? "",
    /403/,
    `expected the real failure to be carried through, got: ${result.error}`,
  );
});

test("fetchShortInterestResult: a real row still parses correctly (no regression)", async () => {
  const result = await fetchShortInterestResult("AAPL");
  assert.equal(result.error, null);
  assert.equal(result.row?.days_to_cover, 0.0084);
});

test("fetchShortInterest: UNCHANGED -- still resolves null on a failed fetch (pre-existing contract, no behavior change)", async () => {
  shortInterestOutcome = { kind: "fail", status: 403 };
  const row = await fetchShortInterest("TSLA");
  assert.equal(row, null, "fetchShortInterest must still just resolve null on any miss -- unaffected by this fix");
});

test("fetchShortVolumeResult: a genuine successful-empty fetch returns {rows: [], error: null} -- unchanged absence", async () => {
  shortVolumeOutcome = { kind: "ok", results: [] };
  const result = await fetchShortVolumeResult("ZZZZ");
  assert.deepEqual(result.rows, []);
  assert.equal(result.error, null);
});

test("fetchShortVolumeResult: a FAILED fetch (429 rate-limited) carries the real error, not a bare empty array", async () => {
  shortVolumeOutcome = { kind: "fail", status: 429 };
  const result = await fetchShortVolumeResult("MSTR");
  assert.deepEqual(result.rows, []);
  assert.match(
    result.error ?? "",
    /429/,
    `expected the real failure to be carried through, got: ${result.error}`,
  );
});

test("fetchShortVolumeResult: a real row still parses correctly (no regression)", async () => {
  const result = await fetchShortVolumeResult("AAPL");
  assert.equal(result.error, null);
  assert.equal(result.rows[0]?.short_volume_ratio, 0.1);
});

test("fetchShortVolume: UNCHANGED -- still resolves [] on a failed fetch (pre-existing contract, no behavior change)", async () => {
  shortVolumeOutcome = { kind: "fail", status: 500 };
  const rows = await fetchShortVolume("MSTR");
  assert.deepEqual(rows, [], "fetchShortVolume must still just resolve [] on any miss -- unaffected by this fix");
});

test("fetchShortInterestResult / fetchShortVolumeResult BOTH failing together carry both real errors independently", async () => {
  shortInterestOutcome = { kind: "fail", status: 403 };
  shortVolumeOutcome = { kind: "fail", status: 403 };
  const [si, sv] = await Promise.all([fetchShortInterestResult("MSTR"), fetchShortVolumeResult("MSTR")]);
  assert.match(si.error ?? "", /403/);
  assert.match(sv.error ?? "", /403/);
});
